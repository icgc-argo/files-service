/*
 * Copyright (c) 2020 The Ontario Institute for Cancer Research. All rights reserved
 *
 * This program and the accompanying materials are made available under the terms of
 * the GNU Affero General Public License v3.0. You should have received a copy of the
 * GNU Affero General Public License along with this program.
 *  If not, see <http://www.gnu.org/licenses/>.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
 * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
 * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import PromisePool from '@supercharge/promise-pool';

import _ from 'lodash';

import { EmbargoStage, File, FileReleaseState } from '../data/files';
import { getClient } from '../external/elasticsearch';
import getRollcall, { Index, getIndexFromIndexName } from '../external/rollcall';
import Logger from '../logger';
import { camelCaseKeysToSnakeCase } from '../utils/objectFormatter';

import { FileCentricDocument } from './fileCentricDocument';
import {
	isFileCentricPublished,
	isFilePublished,
	isPublic,
	isRestricted,
	sortFileDocsIntoPrograms,
	sortFilesIntoPrograms,
} from './utils/fileUtils';
const logger = Logger('Indexer');

type ReleaseOptions = {
	publicRelease?: boolean;
	indices?: string[];
};

const MAX_ES_WRITE_CONCURRENCY = 5;

/**
 * NOTE re: MAX_FILE_BULK_WRITE_LENGTH
 * document length is not the best metric to restrict the bulk write operation since each document
 * can have a different size. It is a reasonable proxy however since ES has been very comfortable
 * writing indexes with up to 15k file documents.
 *  */
const MAX_FILE_BULK_WRITE_LENGTH = 5000;

/**
 * Indexer has separate methods for interacting with restricted and public indices in an attempt to prevent
 * manipulation of public indices when it is not intended. There are no actions that should be affecting both
 * restricted and public indices at the same time so this separation has proved useful when writing out processes.
 *
 * Note that the indexer tracks the next index to create
 */
export const getIndexer = async () => {
	const rollcall = await getRollcall();
	const client = await getClient();

	async function indexFiles(index: string, files: FileCentricDocument[]): Promise<void> {
		const fileChunks = _.chunk(files, MAX_FILE_BULK_WRITE_LENGTH);

		for (let fileChunk of fileChunks) {
			const camelcasedFiles = fileChunk.map(camelCaseKeysToSnakeCase);
			const body = camelcasedFiles.flatMap(file => [
				{ update: { _id: file.object_id } },
				{
					doc_as_upsert: true,
					doc: file,
				},
			]);

			try {
				logger.info(`Sending bulk index request to "${index}" for ${fileChunk.length} file documents`);
				await client.bulk({
					index,
					body,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : error;
				logger.error(`Failed bulk indexing request: ${message}`, error);
				throw error;
			}
		}
	}

	// No reason to have concurrent requests to getNextIndex and getCurrentIndex, so for all fetch from Rollcall
	// nextIndices and currentIndices store a record of which program names are currently being fetched.
	// These also store the resolved names so that repeat fetches are not needed.
	type IndexNameHolder = {
		public: { [programId: string]: Index };
		restricted: { [programId: string]: Index };
		fetching: Set<string>;
	};
	const nextIndices: IndexNameHolder = {
		public: {},
		restricted: {},
		fetching: new Set<string>(),
	};
	const currentIndices: IndexNameHolder = {
		public: {},
		restricted: {},
		fetching: new Set<string>(),
	};

	async function getCurrentIndex(program: string, options: { isPublic: boolean }): Promise<string | undefined> {
		const { isPublic } = options;
		const publicIdentifier = isPublic ? 'public' : 'restricted'; // for choosing correct section of resolvedIndices

		// Idle while waiting for other fetching requests to resolve
		while (currentIndices.fetching.has(program)) {
			await new Promise(resolve => {
				setTimeout(() => resolve(undefined), 20);
			});
		}

		// Nothing currently fetching, check for a previously resolved name
		const existingIndex: Index | undefined = currentIndices[publicIdentifier][program];
		if (existingIndex) {
			return existingIndex.indexName;
		}

		// Index name hasn't been retrieved, so this one instance can fetch.
		try {
			currentIndices.fetching.add(program);

			// Index hasn't been fetched yet, lets go grab it.
			const currentIndex = await rollcall.fetchCurrentIndex(program, isPublic);
			if (!currentIndex) {
				return undefined;
			}

			currentIndices[publicIdentifier][program] = currentIndex;

			return currentIndex.indexName;
		} finally {
			currentIndices.fetching.delete(program);
		}
	}

	/**
	 * If the index does not yet exist, this will create that index.
	 * When creating an index, it will clone from current if clone = true.
	 * @param program
	 * @param options public = false, current = false, clone = true
	 * @returns
	 */
	const getNextIndex = async (program: string, options: { isPublic: boolean; clone: boolean }): Promise<string> => {
		const { isPublic: isPublic, clone: cloneFromReleasedIndex } = options;
		const publicIdentifier = isPublic ? 'public' : 'restricted'; // for choosing correct section of resolvedIndices

		// While concurrent requests are fetching, just idle in this while loop
		while (nextIndices.fetching.has(program)) {
			await new Promise(resolve => {
				setTimeout(() => resolve(undefined), 20);
			});
		}

		// Nothing currently fetching, check for a previously resolved name
		const existingIndex: Index | undefined = nextIndices[publicIdentifier][program];
		if (existingIndex) {
			return existingIndex.indexName;
		}

		// Index name hasn't been retrieved, so this one instance can fetch.
		try {
			nextIndices.fetching.add(program);

			// Index hasn't been fetched yet, lets go grab it.
			const nextIndex = await rollcall.fetchNextIndex(program, {
				isPublic,
				cloneFromReleasedIndex,
			});
			nextIndices[publicIdentifier][program] = nextIndex;

			return nextIndex.indexName;
		} finally {
			nextIndices.fetching.delete(program);
		}
	};

	/**
	 * Add prepared indices to the file alias. By default, this will add all indices in the nextIndices.restricted map to the alias.
	 *   Optionally, a publicRelease can be requested and will also include the nextInidces.public map.
	 *   Additional indices can be specified int eh request options to also be released. This is done when releasing an index prepared during a previous process (not by this indexer object)
	 * @param options
	 */
	async function release(options?: ReleaseOptions): Promise<void> {
		// Default publicRelease to false;
		const publicRelease = options ? options.publicRelease : false;
		const additionalIndices: string[] = options && options.indices ? options.indices : [];

		logger.info(
			`Preparing to release indices to the file alias. Restricted Indices to release: ${Object.keys(
				nextIndices.restricted,
			)}`,
		);
		const toRelease = Object.values(nextIndices.restricted);
		if (publicRelease) {
			logger.info(`Preparing to release... adding public indices to release list: ${Object.keys(nextIndices.public)}`);
			toRelease.concat(Object.values(nextIndices.public));
		}

		if (additionalIndices.length) {
			logger.info(`Preparing to release... Additional indices requested to release: ${additionalIndices}`);
		}

		// TODO: config for max simultaneous release?
		// release indices tracked in nextIndices and requested in options.additionalIndices
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(toRelease.concat(additionalIndices.map(getIndexFromIndexName)))
			.handleError((error, index) => {
				logger.error(`Failed to release index: ${index.indexName}`);
			})
			.process(async index => {
				logger.info(`Releasing index to file alias: ${index.indexName}`);
				await rollcall.release(index);
			});

		// Clear stored index names to prevent repeat releases.
		nextIndices.public = {};
		nextIndices.restricted = {};
	}

	/**
	 * Update file properties maintained by this file-manager application:
	 *   - embargo_stage
	 *   - release_state
	 * Also update these values in the document meta data object.
	 *
	 * NOTE: This will throw an error if the file is not yet indexed.
	 * @param file
	 */
	async function updateRestrictedFile(file: File): Promise<void> {
		// Don't update a file if it is not in a RESTRICTED releaseState
		if (!isRestricted(file)) {
			logger.warn(
				`updateRestrictedFile()`,
				`Returning without indexing file ${file.fileId} because it is not in a Restricted releaseState: ${file.releaseState}`,
			);
			return;
		}

		// Don't run updates on unpublished files
		if (!isFilePublished(file)) {
			logger.warn(
				`updateRestrictedFile()`,
				`Returning without indexing file ${file.fileId} because it is not Published in Song: ${file.status}`,
			);
			return;
		}

		const index = await getNextIndex(file.programId, {
			isPublic: false,
			clone: true,
		});

		// updates for the file in ES
		if (file.releaseState === FileReleaseState.UNRELEASED) {
			// Remove document
			await client.delete({ index, id: file.objectId });
		} else {
			// Update document
			const doc = {
				embargo_stage: file.embargoStage,
				release_state: file.releaseState,
				meta: {
					embargo_stage: file.embargoStage,
					release_state: file.releaseState,
				},
			};

			await client.update({
				index,
				id: file.objectId,
				body: { doc },
			});
		}
	}

	/**
	 * Update restricted file centric index documents
	 * No change for files with Public release
	 * @param docs
	 */
	async function indexRestrictedFileDocs(docs: FileCentricDocument[]): Promise<void> {
		// Only indexing docs that are restricted and published in song
		const filteredFiles = docs.filter(doc => isRestricted(doc) && isFileCentricPublished(doc));
		const sortedFiles = sortFileDocsIntoPrograms(filteredFiles);

		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(sortedFiles)
			.process(async ({ program, files }) => {
				const index = await getNextIndex(program, {
					isPublic: false,
					clone: true,
				});
				await indexFiles(index, files);
			});
	}

	/**
	 * Remove a file from a restricted file centric index
	 * @param docs
	 */
	async function removeRestrictedFileDocs(docs: FileCentricDocument[]): Promise<void> {
		// Only removing files that are not public
		const sortedFiles = sortFileDocsIntoPrograms(docs.filter(isRestricted));

		// TODO: configure concurrency for ES requests.
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(sortedFiles)
			.process(async ({ program, files }) => {
				const body = files.map(file => ({ delete: { _id: file.objectId } }));
				const index = await getNextIndex(program, { isPublic: false, clone: true });

				try {
					await client.bulk({
						index,
						body,
					});
				} catch (e) {
					logger.error(`Failed bulk delete request: ${JSON.stringify(e)}`, e);
					throw e;
				}
			});
	}

	async function createEmptyPublicIndices(programs: string[]): Promise<string[]> {
		const publicIndices: string[] = [];
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(programs)
			.process(async program => {
				const index = await getNextIndex(program, { isPublic: true, clone: false });
				publicIndices.push(index);
			});
		return publicIndices;
	}

	async function createEmptyRestrictedIndices(programs: string[]): Promise<string[]> {
		const restrictedIndices: string[] = [];
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(programs)
			.process(async program => {
				const index = await getNextIndex(program, { isPublic: false, clone: false });
				restrictedIndices.push(index);
			});
		return restrictedIndices;
	}

	/**
	 * Update restricted file centric index documents
	 * No change for files with Public release
	 * @param docs
	 */
	async function indexPublicFileDocs(docs: FileCentricDocument[]): Promise<void> {
		// Only indexing docs that are PUBLIC
		const filteredFiles = docs.filter(
			doc => isPublic(doc) && doc.embargoStage === EmbargoStage.PUBLIC && isFileCentricPublished(doc),
		);
		const sortedFiles = sortFileDocsIntoPrograms(filteredFiles);

		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(sortedFiles)
			.process(async ({ program, files }) => {
				const index = await getNextIndex(program, {
					isPublic: true,
					clone: true,
				});
				await indexFiles(index, files);
			});
	}

	/**
	 * Note: No longer used in release process. Keeping this for use in emergency updates to public indices requiring removing files from an index.
	 * @param files
	 */
	async function removeFilesFromPublic(files: File[]): Promise<void> {
		const sortedFiles = sortFilesIntoPrograms(files);

		// TODO: Configure ES request concurrency
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(sortedFiles)
			.process(async programData => {
				const body = programData.files.map(file => ({ delete: { _id: file.objectId } }));
				const index = await getNextIndex(programData.program, {
					isPublic: true,
					clone: true,
				});

				try {
					await client.bulk({
						index,
						body,
					});
				} catch (e) {
					logger.error(`Failed bulk delete request: ${JSON.stringify(e)}`, e);
					throw e;
				}
			});
	}

	async function removeFilesFromRestricted(files: File[]): Promise<void> {
		const sortedFiles = sortFilesIntoPrograms(files);

		// TODO: Configure ES request concurrency
		await PromisePool.withConcurrency(MAX_ES_WRITE_CONCURRENCY)
			.for(sortedFiles)
			.process(async programData => {
				const body = programData.files.map(file => ({ delete: { _id: file.objectId } }));
				const index = await getNextIndex(programData.program, {
					isPublic: false,
					clone: true,
				});

				try {
					await client.bulk({
						index,
						body,
					});
				} catch (e) {
					logger.error(`Failed bulk delete request: ${JSON.stringify(e)}`, e);
					throw e;
				}
			});
	}

	async function deleteIndices(indices: string[]): Promise<void> {
		if (!indices || !indices.length) {
			return;
		}
		await client.indices.delete({ index: indices });

		// remove the nextIndices and currentIndices references to these indexNames
		indices.forEach(indexName => {
			for (const programId in currentIndices.public) {
				if (currentIndices.public[programId].indexName === indexName) {
					delete currentIndices.public[programId];
				}
			}
			for (const programId in currentIndices.restricted) {
				if (currentIndices.restricted[programId].indexName === indexName) {
					delete currentIndices.restricted[programId];
				}
			}
			for (const programId in nextIndices.public) {
				if (nextIndices.public[programId].indexName === indexName) {
					delete nextIndices.public[programId];
				}
			}
			for (const programId in nextIndices.restricted) {
				if (nextIndices.restricted[programId].indexName === indexName) {
					delete nextIndices.restricted[programId];
				}
			}
		});
	}

	return {
		createEmptyPublicIndices,
		createEmptyRestrictedIndices,

		deleteIndices,

		indexPublicFileDocs,
		indexRestrictedFileDocs,

		removeFilesFromPublic,
		removeFilesFromRestricted,
		removeRestrictedFileDocs,

		updateRestrictedFile,

		release,
	};
};

export type Indexer = Awaited<ReturnType<typeof getIndexer>>;
