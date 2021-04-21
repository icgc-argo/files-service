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

type ReleaseOptions = {
  publicRelease: boolean;
};
export interface Indexer {
  updateFile: (file: File) => Promise<void>;
  indexFiles: (docs: FileCentricDocument[]) => Promise<void>;
  removeFiles: (docs: FileCentricDocument[]) => Promise<void>;
  release: (options?: ReleaseOptions) => Promise<void>;
}
export const getIndexer = async (options?: { doClone: boolean }) => {
  // Default doClone to true.
  const doClone = options ? options.doClone : true;

  const rollcall = await getRollcall();

  type IndexNameHolder = {
    public: { [programId: string]: Index };
    restricted: { [programId: string]: Index };
  };
  const resolvedIndices: IndexNameHolder = {
    public: {},
    restricted: {},
  };

  const getIndexName = async (program: string, isPublic: boolean): Promise<string> => {
    const publicIdentifier = isPublic ? 'public' : 'restricted'; // for choosing correct section of resolvedIndices

    const existingIndex: Index | undefined = resolvedIndices[publicIdentifier][program];
    if (existingIndex) {
      return existingIndex.indexName;
    }

    // Index hasn't been fetched yet, lets go grab it.
    const nextIndex = await rollcall.fetchNextIndex(program, {
      isPublic,
      cloneFromReleasedIndex: doClone,
    });
    resolvedIndices[publicIdentifier][program] = nextIndex;
    return nextIndex.indexName;
  };

  async function release(options?: ReleaseOptions) {
    // Default publicRelease to false;
    const publicRelease = options ? options.publicRelease : false;

    const toRelease = Object.values(resolvedIndices.restricted);
    if (publicRelease) {
      toRelease.concat(Object.values(resolvedIndices.public));
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
    resolvedIndices.public = {};
    resolvedIndices.restricted = {};
  }

  /**
   * Update the parts of the file managed by this service:
   *   - embargo_stage
   *   - release_state
   * @param file
   */
  async function updateFile(file: File) {
    // updates for the file in ES
    const doc = {
      embargo_stage: file.embargoStage,
      release_state: file.releaseState,
    };

    const client = await getClient();
    await client.update({
      index: await getIndexName(file.programId, false),
      id: file.objectId,
      body: { doc },
    });
  }

  async function indexFiles(docs: FileCentricDocument[]) {
    const sortedFiles = sortFilesIntoPrograms(docs);

    const client = await getClient();

    PromisePool.withConcurrency(20)
      .for(sortedFiles)
      .process(async ({ program, files }) => {
        const index = await getIndexName(program, false);
        const body = files.map(camelCaseKeysToUnderscore).flatMap(doc => [
          { update: { _id: doc.object_id } },
          {
            doc_as_upsert: true,
            doc,
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

  async function removeFiles(docs: FileCentricDocument[]) {
    const sortedFiles = sortFilesIntoPrograms(docs);

    const client = await getClient();

    // TODO: configure concurrency for ES requests.
    PromisePool.withConcurrency(20)
      .for(sortedFiles)
      .process(async ({ program, files }) => {
        const body = docs.map(doc => ({ delete: { _id: doc.objectId } }));

        try {
          await client.bulk({
            index: await getIndexName(program, false),
            body,
          });
        } catch (e) {
          logger.error(`Failed bulk delete request: ${JSON.stringify(e)}`, e);
          throw e;
        }
      });
  }

  return {
    updateFile,
    indexFiles,
    removeFiles,
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
type FilesSortedByProgramsArray = Array<{ files: FileCentricDocument[]; program: string }>;
function sortFilesIntoPrograms(files: FileCentricDocument[]): FilesSortedByProgramsArray {
  const output: FilesSortedByProgramsArray = [];

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
