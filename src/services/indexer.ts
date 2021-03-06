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

import logger from '../logger';
import { EmbargoStage, FileReleaseState } from '../data/files';
import { getClient } from '../external/elasticsearch';
import { getAppConfig } from '../config';
import { FileCentricDocument } from './fileCentricDocument';
import { File } from '../data/files';
import getRollcall, { getIndexFromIndexName, Index } from '../external/rollcall';
import { timeout } from 'promise-tools';

type ReleaseOptions = {
  publicRelease?: boolean;
  indices?: string[];
};

export interface Indexer {
  indexFileDocs: (docs: FileCentricDocument[]) => Promise<void>;
  removeFileDocs: (docs: FileCentricDocument[]) => Promise<void>;

  updateFile: (file: File) => Promise<void>;

  preparePublicIndices: (programs: string[]) => Promise<string[]>;
  copyFilesToPublic: (files: File[]) => Promise<void>;
  removeFilesFromPublic: (files: File[]) => Promise<void>;
  release: (options?: ReleaseOptions) => Promise<void>;
}
export const getIndexer = async () => {
  const rollcall = await getRollcall();
  const client = await getClient();

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

  async function getCurrentIndex(
    program: string,
    options: { isPublic: boolean },
  ): Promise<string | undefined> {
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
  const getNextIndex = async (
    program: string,
    options: { isPublic: boolean; clone: boolean },
  ): Promise<string> => {
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
      `[Indexer] Preparing to release indices to the file alias. Restricted Indices to release: ${Object.keys(
        nextIndices.restricted,
      )}`,
    );
    const toRelease = Object.values(nextIndices.restricted);
    if (publicRelease) {
      logger.info(
        `[Indexer] Preparing to release... adding public indices to release list: ${Object.keys(
          nextIndices.public,
        )}`,
      );
      toRelease.concat(Object.values(nextIndices.public));
    }

    if (additionalIndices.length) {
      logger.info(
        `[Indexer]  Preparing to release... Additional indices requested to release: ${additionalIndices}`,
      );
    }

    // TODO: config for max simultaneous release?
    // release indices tracked in nextIndices
    await PromisePool.withConcurrency(5)
      .for(toRelease)
      .handleError((error, index) => {
        logger.error(`Failed to release index: ${index.indexName}`);
      })
      .process(async index => {
        logger.info(`[Indexer] Releasing index to file alias: ${index.indexName}`);
        await rollcall.release(index);
      });

    // release indices requested in options.additionalIndices
    await PromisePool.withConcurrency(5)
      .for(additionalIndices)
      .handleError((error, indexName) => {
        logger.error(`Failed to release index: ${indexName}`);
      })
      .process(async indexName => {
        logger.debug(`[Indexer] Releasing index to file alias: ${indexName}`);
        const index = getIndexFromIndexName(indexName);
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
   * @param file
   */
  async function updateFile(file: File): Promise<void> {
    // Don't update a file if it is PUBLIC already
    if (file.releaseState === FileReleaseState.PUBLIC) {
      return;
    }

    // updates for the file in ES
    const doc = {
      embargo_stage: file.embargoStage,
      release_state: file.releaseState,
      meta: {
        embargo_stage: file.embargoStage,
        release_state: file.releaseState,
      },
    };

    const body = [{ update: { _id: file.objectId } }, { doc }];

    const index = await getNextIndex(file.programId, {
      isPublic: false,
      clone: true,
    });
    await client.update({
      index,
      id: file.objectId,
      body: { doc },
    });
  }

  /**
   * For indexing updates as they come in from
   * @param docs
   */
  async function indexFileDocs(docs: FileCentricDocument[]): Promise<void> {
    // Only indexing docs that are not PUBLIC
    const sortedFiles = sortFileDocsIntoPrograms(
      docs.filter(doc => doc.releaseState !== FileReleaseState.PUBLIC),
    );

    await PromisePool.withConcurrency(20)
      .for(sortedFiles)
      .process(async ({ program, files }) => {
        const index = await getNextIndex(program, {
          isPublic: false,
          clone: true,
        });
        const camelcased = files.map(camelCaseKeysToUnderscore);
        const body = camelcased.flatMap(file => [
          { update: { _id: file.object_id } },
          {
            doc_as_upsert: true,
            doc: file,
          },
        ]);

        try {
          await client.bulk({
            index,
            body,
          });
        } catch (e) {
          logger.error(`Failed bulk indexing request: ${JSON.stringify(e)}`, e);
          throw e;
        }
      });
  }

  async function removeFileDocs(docs: FileCentricDocument[]): Promise<void> {
    // Only removing files that are not public
    const sortedFiles = sortFileDocsIntoPrograms(
      docs.filter(doc => doc.releaseState !== FileReleaseState.PUBLIC),
    );

    // TODO: configure concurrency for ES requests.
    await PromisePool.withConcurrency(5)
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

  async function preparePublicIndices(programs: string[]): Promise<string[]> {
    const publicIndices: string[] = [];
    await PromisePool.withConcurrency(5)
      .for(programs)
      .process(async program => {
        const index = await getNextIndex(program, { isPublic: true, clone: true });
        publicIndices.push(index);
      });
    return publicIndices;
  }

  async function copyFilesToPublic(files: File[]): Promise<void> {
    const sortedFiles = sortFilesIntoPrograms(files);

    // TODO: Configure ES request concurrency
    await PromisePool.withConcurrency(5)
      .for(sortedFiles)
      .process(async programData => {
        const program = programData.program;
        const fileIds = programData.files.map(file => file.objectId);

        const restrictedIndex = await getCurrentIndex(program, { isPublic: false });
        const publicIndex = await getNextIndex(program, {
          isPublic: true,
          clone: true,
        });

        if (!restrictedIndex) {
          throw new Error(
            `Failed to move file from restricted to public: no restricted index aliased for ${program}`,
          );
        }

        const body = {
          source: {
            index: restrictedIndex,
            query: {
              bool: {
                filter: {
                  terms: {
                    object_id: fileIds,
                  },
                },
              },
            },
          },
          dest: {
            index: publicIndex,
          },
          // This script makes the indexed document change releaseState and embargoStage to PUBLIC
          // This is the only mechanism used to put a file document into a public index, so this is responsible for making sure the Stage is correct.
          script: {
            source: `ctx._source.release_state = "${FileReleaseState.PUBLIC}"; ctx._source.embargo_stage = "${EmbargoStage.PUBLIC}";ctx._source.meta.release_state = "${FileReleaseState.PUBLIC}"; ctx._source.meta.embargo_stage = "${EmbargoStage.PUBLIC}";`,
          },
        };

        const response = await client.reindex({
          wait_for_completion: true,
          refresh: true,
          body,
        });

        return;
      });
  }

  async function removeFilesFromPublic(files: File[]): Promise<void> {
    const sortedFiles = sortFilesIntoPrograms(files);

    // TODO: Configure ES request concurrency
    await PromisePool.withConcurrency(20)
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
    await PromisePool.withConcurrency(20)
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
    // By FileDocument
    indexFileDocs,
    removeFileDocs,

    updateFile,

    // Public Index Management
    deleteIndices,
    preparePublicIndices,
    copyFilesToPublic,
    removeFilesFromPublic,
    removeFilesFromRestricted,
    release,
  };
};

function camelCaseKeysToUnderscore(obj: any) {
  if (typeof obj != 'object') return obj;

  for (const oldName in obj) {
    // Camel to underscore
    const newName = oldName.replace(/([A-Z])/g, function($1) {
      return '_' + $1.toLowerCase();
    });

    // Only process if names are different
    if (newName != oldName) {
      // Check for the old property name to avoid a ReferenceError in strict mode.
      if (obj.hasOwnProperty(oldName)) {
        obj[newName] = obj[oldName];
        delete obj[oldName];
      }
    }
    if (typeof obj[newName] == 'object') {
      obj[newName] = camelCaseKeysToUnderscore(obj[newName]);
    }
  }
  return obj;
}
// Separate list of file documents into distinct list per program.
type FileDocsSortedByProgramsArray = Array<{ files: FileCentricDocument[]; program: string }>;
function sortFileDocsIntoPrograms(files: FileCentricDocument[]): FileDocsSortedByProgramsArray {
  const output: FileDocsSortedByProgramsArray = [];

  // Sort Files into programs
  const programMap = files.reduce((acc: { [program: string]: FileCentricDocument[] }, file) => {
    const program = file.studyId;
    if (acc[program]) {
      acc[program].push(file);
    } else {
      acc[program] = [file];
    }
    return acc;
  }, {});

  // For each program, add an element to output array
  Object.entries(programMap).forEach(([program, files]) => {
    output.push({ program, files });
  });
  return output;
}
// Separate list of files into distinct list per program.
type FilesSortedByProgramsArray = Array<{ files: File[]; program: string }>;
function sortFilesIntoPrograms(files: File[]): FilesSortedByProgramsArray {
  const output: FilesSortedByProgramsArray = [];

  // Sort Files into programs
  const programMap = files.reduce((acc: { [program: string]: File[] }, file) => {
    const program = file.programId;
    if (acc[program]) {
      acc[program].push(file);
    } else {
      acc[program] = [file];
    }
    return acc;
  }, {});

  // For each program, add an element to output array
  Object.entries(programMap).forEach(([program, files]) => {
    output.push({ program, files });
  });
  return output;
}
