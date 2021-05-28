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
import { getClient } from '../external/elasticsearch';
import { getAppConfig } from '../config';
import { FileCentricDocument } from './fileCentricDocument';
import { File } from '../data/files';
import getRollcall, { Index } from '../external/rollcall';
import { timeout } from 'promise-tools';

type ReleaseOptions = {
  publicRelease: boolean;
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

  async function release(options?: ReleaseOptions): Promise<void> {
    // Default publicRelease to false;
    const publicRelease = options ? options.publicRelease : false;

    const toRelease = Object.values(nextIndices.restricted);
    if (publicRelease) {
      toRelease.concat(Object.values(nextIndices.public));
    }

    // TODO: config for max simultaneous release?
    await PromisePool.withConcurrency(5)
      .for(toRelease)
      .handleError((error, index) => {
        logger.error(`Failed to release index: ${index.indexName}`);
      })
      .process(async indexName => {
        await rollcall.release(indexName);
      });
    // Clear stored index names to prevent repeat releases.
    nextIndices.public = {};
    nextIndices.restricted = {};
  }

  /**
   * Update tfile properties maintained by this file-manager application:
   *   - embargo_stage
   *   - release_state
   * @param file
   */
  async function updateFile(file: File): Promise<void> {
    // updates for the file in ES
    const doc = {
      embargo_stage: file.embargoStage,
      release_state: file.releaseState,
    };

    const body = [{ update: { _id: file.objectId } }, { doc }];

    const index = await getNextIndex(file.programId, {
      isPublic: false,
      clone: true,
    });
    logger.debug(`Update doc ${index} ${file.objectId} ${JSON.stringify(doc)}`);
    await client.update({
      index,
      id: file.objectId,
      body: { doc },
    });
  }

  async function indexFileDocs(docs: FileCentricDocument[]): Promise<void> {
    const sortedFiles = sortFileDocsIntoPrograms(docs);

    await PromisePool.withConcurrency(20)
      .for(sortedFiles)
      .process(async ({ program, files }) => {
        const index = await getNextIndex(program, {
          isPublic: false,
          clone: true,
        });
        const body = files.map(camelCaseKeysToUnderscore).flatMap(file => [
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
    const sortedFiles = sortFileDocsIntoPrograms(docs);

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

    logger.debug(`Copying sorted files into public indices`);

    // TODO: Configure ES request concurrency
    await PromisePool.withConcurrency(5)
      .for(sortedFiles)
      .process(async programData => {
        const program = programData.program;
        const fileIds = programData.files.map(file => file.objectId);

        logger.debug(`pre restricted index, program: ${program} , fileIds: ${fileIds}`);
        const restrictedIndex = await getCurrentIndex(program, { isPublic: false });
        logger.debug(`restricted index: ${restrictedIndex}`);
        const publicIndex = await getNextIndex(program, {
          isPublic: true,
          clone: true,
        });
        logger.debug(`public index: ${publicIndex}`);
        logger.debug(`Indices for copy... From ${restrictedIndex} to ${publicIndex}`);

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
        };

        const response = await client.reindex({
          wait_for_completion: true,
          refresh: true,
          body,
        });

        logger.debug(`Done copy.`);
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

  async function deleteIndices(indices: string[]): Promise<void> {
    await client.indices.delete({ index: indices });

    // remove the nextIndices and currentIndices references to these indexNames
    indices.forEach(indexName => {
      for (let programId in currentIndices.public) {
        if (currentIndices.public[programId].indexName === indexName) {
          delete currentIndices.public[programId];
        }
      }
      for (let programId in currentIndices.restricted) {
        if (currentIndices.restricted[programId].indexName === indexName) {
          delete currentIndices.restricted[programId];
        }
      }
      for (let programId in nextIndices.public) {
        if (nextIndices.public[programId].indexName === indexName) {
          delete nextIndices.public[programId];
        }
      }
      for (let programId in nextIndices.restricted) {
        if (nextIndices.restricted[programId].indexName === indexName) {
          delete nextIndices.restricted[programId];
        }
      }
    });
  }

  return {
    indexFileDocs,
    removeFileDocs,

    updateFile,

    // Public Index Management
    deleteIndices,
    preparePublicIndices,
    copyFilesToPublic,
    removeFilesFromPublic,
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
