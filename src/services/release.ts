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

import { File, FileReleaseState, EmbargoStage } from '../data/files';
import * as fileService from '../data/files';
import { Release } from '../data/releases';
import * as releaseService from '../data/releases';
import { createSnapshot } from '../external/elasticsearch';
import StringMap from '../utils/StringMap';
import { getIndexer } from './indexer';
import getRollcall, { Index } from '../external/rollcall';
import logger from '../logger';

function toFileId(file: File) {
  return file.objectId;
}

export async function calculateRelease(): Promise<Release> {
  // Get files that are currently public, and those queued for public release
  // Add these to the active release. Release service handles creating new release if active release not available.

  const publicFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.PUBLIC,
  });
  const queuedFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.QUEUED,
  });
  const kept = publicFiles.map(toFileId);
  const added = queuedFiles.map(toFileId);

  const release = releaseService.updateActiveReleaseFiles({
    kept,
    added,
    removed: [], // TODO: Implement removed files after we build a "withdraw" mechanism for files.
  });

  return release;
}

/**
 * Build public indices for a release and save as snapshot.
 * This does:
 *  - Create the new public indices, adding and removing the files as required
 *  - TODO: Update from song (and clincial eventually) all files kept and added in the release
 *  - TODO: Snapshot the new indices in ES
 * This does not:
 *  - Alias the new indices (no change to the live platform data)
 *  - Update the embargoStage or releaseState of any files
 *  - Remove files from the restricted indices
 *
 * @param label
 */
export async function buildActiveRelease(label: string): Promise<Release> {
  let release = await releaseService.getActiveRelease();
  if (!release) {
    throw new Error('No Active release available.');
  }

  release = await releaseService.updateActiveReleaseLabel(label);

  // 1. Sort files into programs, published and restricted

  const programs: StringMap<{ kept: File[]; added: File[] }> = {};
  const filesKept: File[] = await fileService.getFilesFromObjectIds(release.filesKept);
  const filesAdded: File[] = await fileService.getFilesFromObjectIds(release.filesAdded);
  const filesRemoved: File[] = await fileService.getFilesFromObjectIds(release.filesRemoved);

  const programIds = new Set<string>();
  filesKept.forEach(file => programIds.add(file.programId));
  filesAdded.forEach(file => programIds.add(file.programId));
  filesRemoved.forEach(file => programIds.add(file.programId));

  filesKept.forEach(file => {
    const program = file.programId;
    if (!programs[program]) {
      programs[program] = { kept: [], added: [] };
    }
    programs[program].kept.push(file);
  });
  filesAdded.forEach(file => {
    const program = file.programId;
    if (!programs[program]) {
      programs[program] = { kept: [], added: [] };
    }
    programs[program].added.push(file);
  });

  // 2. Create public indices for each program (no clone!)
  const indexer = await getIndexer();

  // 2.a If the release already has public indices, remove those so we can build from the existing indices.
  await indexer.deleteIndices(release.indices);
  release = await releaseService.updateActiveReleaseIndices([]);

  // 2.b Clone new public indices from the current public indices.
  const publicIndices = await indexer.preparePublicIndices(Array.from(programIds));
  release = await releaseService.updateActiveReleaseIndices(publicIndices);

  // 3. Perform reindex of required documents from source indices to new published indices.

  await indexer.copyFilesToPublic(filesAdded);
  await indexer.removeFilesFromPublic(filesRemoved);

  // 4. Make snapshot!
  const snapshot = await createSnapshot({ indices: release.indices, label: release.label });
  if (snapshot) {
    release = await releaseService.updateActiveReleaseSnapshot(snapshot);
  }

  return release;
}

/**
 * Publish release will add the public indices created in the build step to the file alias
 *   This will also modify the restricted indices by:
 *     - TODO: Any files removed from public will be added to a new restricted index
 *     - Any files move to public will be removed from the new restricted index
 *     - The new restricted indices will be aliased
 *   This will modify the files in the database by:
 *     - Update the embargo_stage and release_state of any files that have been moved to public/restricted
 */
export async function publishActiveRelease(): Promise<Release> {
  let release = await releaseService.getActiveRelease();
  if (!release) {
    throw new Error('No Active release available.');
  }
  if (!(release.indices.length > 0)) {
    throw new Error('Active release has no public indices. Nothing to publish.');
  }

  const filesAdded: File[] = await fileService.getFilesFromObjectIds(release.filesAdded);
  const filesRemoved: File[] = await fileService.getFilesFromObjectIds(release.filesRemoved);

  const indexer = await getIndexer();

  // 1. Added files - Remove from restricted index
  await indexer.removeFilesFromRestricted(filesAdded);
  logger.debug(`[Release.Publish] ${filesAdded.length} Files removed from restricted index`);

  // TODO: Getting the add to public working before circling back to removing and updating out of date files.
  // 2. Removed files
  //  2a. Fetch file data from RDPC
  //  2b. Add file data to restricted index

  // 3. Release all indices (public and restricted)
  await indexer.release({ publicRelease: true, indices: release.indices });
  logger.debug(`[Release.Publish] Release Indices have been aliased.`);

  // 4. Update DB with published changes
  await PromisePool.withConcurrency(20)
    .for(release.filesAdded)
    .handleError((error, file) => {
      logger.error(`Failed to update release status in DB for ${file}`);
    })
    .process(async file => {
      await fileService.updateFileReleaseProperties(file, {
        embargoStage: EmbargoStage.PUBLIC,
        releaseState: FileReleaseState.PUBLIC,
      });
    });
  logger.debug(`[Release.Publish] File records in DB updated with new published states.`);
  // TODO: when implementing the filesRemoved logic, check if the release_state needs to be updated in DB or
  //  if that change is handled when the embargoStage calculation is redone when the file was modified to no
  //  longer be public. I.E. We may need to update the DB with releaseState that is not PUBLIC

  // 5. Update the release to track the changed status
  // 5a. release.state should now be PUBLISHED
  // 5b. record publishedAt date
  release = await releaseService.publishActiveRelease();
  logger.debug(`[Release.Publish] Release marked as published.`);

  return release;
}
