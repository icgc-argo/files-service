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

import { File, FileReleaseState, EmbargoStage } from '../data/files';
import * as fileService from '../data/files';
import { Release } from '../data/releases';
import * as releaseService from '../data/releases';

import { createSnapshot } from '../external/elasticsearch';
import { sendPublicReleaseMessage } from '../external/kafka';

import StringMap from '../utils/StringMap';
import { Program, PublicReleaseMessage } from 'kafkaMessages';

import { getIndexer } from './indexer';
import * as fileManager from './fileManager';

import Logger from '../logger';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
const logger = Logger('ReleaseManager');

function toFileId(file: File) {
  return file.objectId;
}

export async function calculateRelease(): Promise<void> {
  // Get files that are currently public, and those queued for public release
  // Add these to the active release. Release service handles creating new release if active release not available.

  logger.info(`Beginning release calculation...`);

  const publicFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.PUBLIC,
  });
  const queuedFiles = await fileService.getFilesByState({
    releaseState: FileReleaseState.QUEUED,
  });
  const kept = publicFiles.map(toFileId);
  const added = queuedFiles.map(toFileId);

  await releaseService.updateActiveReleaseFiles({
    kept,
    added,
    removed: [], // TODO: Implement removed files after we build a "withdraw" mechanism for files.
  });

  logger.info(`Finishing release calculation!`);
  const { updated, message } = await releaseService.finishCalculatingActiveRelease();
  if (!updated) {
    logger.error(`Unable to set release to Calculated: ${message}`);
    releaseService.setActiveReleaseError(
      'Release expected to be set as calculated but was in the wrong state.',
    );
  }
}

/**
 * Build public indices for a release and save as snapshot.
 * This does:
 *  - Create the new public indices, adding and removing the files as required
 *  - TODO: Update from song (and clincial eventually) all files kept and added in the release
 *  - Snapshot the new indices in ES
 * This does not:
 *  - Alias the new indices (no change to the live platform data)
 *  - Update the embargoStage or releaseState of any files
 *  - Remove files from the restricted indices
 *
 * @param label
 */
export async function buildActiveRelease(label: string): Promise<void> {
  logger.info(`Beginning release building...`);

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

  // 2.b Make new empty public indices from the current public indices.
  const publicIndices = await indexer.preparePublicIndices(Array.from(programIds));
  release = await releaseService.updateActiveReleaseIndices(publicIndices);

  // 3. Add files all required files to public indices.

  // 3.a Get RDPC data for all included files
  const rdpcFilesToAdd = await fileManager.getRdpcDataForFiles(filesAdded.concat(filesKept));

  // 3.b Convert to FileCentricDocs
  // Limit for concurrency here is DB connections. Can go higher than 1 RDPC at a time but there aren't that many RDPCs to need to push this value
  const fileCentricDocsToAdd: FileCentricDocument[] = [];
  PromisePool.withConcurrency(1)
    .for(rdpcFilesToAdd) // For each rdpc in the files to add
    .process(data => {
      const rdpcFiles = data.files;
      PromisePool.withConcurrency(10)
        .for(rdpcFiles) // For each file doc retrieved from that rdpc
        .process(async rdpcFile => {
          const dbFile = await fileManager.updateFileFromRdpcData(rdpcFile, data.dataCenterId);
          const fileCentricDoc = await buildDocument({ dbFile, rdpcFile });

          // Force the embarge and release state to be public. This will stay as associate/queued in the DB until published.
          fileCentricDoc.embargoStage = EmbargoStage.PUBLIC;
          fileCentricDoc.releaseState = FileReleaseState.PUBLIC;
          fileCentricDocsToAdd.push(fileCentricDoc);
        });
    });

  // 3.c add the updated files to public indices
  await indexer.indexPublicFileDocs(fileCentricDocsToAdd);

  // 4. Make snapshot!
  const snapshot = await createSnapshot({ indices: publicIndices, label });
  if (snapshot) {
    release = await releaseService.updateActiveReleaseSnapshot(snapshot);
  }

  // NOTE: Public indices are not released! that is for the public stage.

  logger.info(`Finishing release build!`);
  const { updated, message } = await releaseService.finishBuildingActiveRelease();
  if (!updated) {
    logger.error(`Unable to set release to Built: ${message}`);
    releaseService.setActiveReleaseError(
      'Release expected to be set as BUILT but was in the wrong state.',
    );
  }
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
export async function publishActiveRelease(): Promise<void> {
  logger.info(`Beginning release publishing...`);

  const release = await releaseService.getActiveRelease();
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
  logger.debug(`${filesAdded.length} Files removed from restricted index`);

  // 2. Removed files
  //  2a. Fetch file data from RDPC
  const rdpcFilesMovingToRestricted = await fileManager.getRdpcDataForFiles(filesRemoved);

  // Limit for concurrency here is DB connections. Can go higher than 1 RDPC at a time but there aren't that many RDPCs to need to push this value
  const fileCentricDocsMovingToRestricted: FileCentricDocument[] = [];
  PromisePool.withConcurrency(1)
    .for(rdpcFilesMovingToRestricted) // For each rdpc in the files to add
    .process(data => {
      const rdpcFiles = data.files;
      PromisePool.withConcurrency(10)
        .for(rdpcFiles) // For each file doc retrieved from that rdpc
        .process(async rdpcFile => {
          const dbFile = await fileManager.updateFileFromRdpcData(rdpcFile, data.dataCenterId);
          const fileCentricDoc = await buildDocument({ dbFile, rdpcFile });
          fileCentricDocsMovingToRestricted.push(fileCentricDoc);
        });
    });

  //  2b. Add file data to restricted index
  indexer.indexRestrictedFileDocs(fileCentricDocsMovingToRestricted);

  // 3. Release all indices (public and restricted)
  await indexer.release({ publicRelease: true, indices: release.indices });
  logger.debug(`Release Indices have been aliased.`);

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
  logger.debug(`File records in DB updated with new published states.`);
  // TODO: when implementing the filesRemoved logic, check if the release_state needs to be updated in DB or
  //  if that change is handled when the embargoStage calculation is redone when the file was modified to no
  //  longer be public. I.E. We may need to update the DB with releaseState that is not PUBLIC

  // 5. Update release state to published
  logger.info(`Finishing release publish!`);
  const { updated, message } = await releaseService.finishPublishingActiveRelease();
  if (updated) {
    // 5b. Send kafka message for public release
    const kafkaMessage = buildKafkaMessage(release, filesAdded, filesRemoved);
    sendPublicReleaseMessage(kafkaMessage);
  } else {
    logger.error(`Unable to set release to published: ${message}`);
    releaseService.setActiveReleaseError(
      'Release expected to be set as published but was in the wrong state.',
    );
  }
}

function buildKafkaMessage(
  release: Release,
  filesAdded: File[],
  filesRemoved: File[],
): PublicReleaseMessage {
  const filesUpdated = _.groupBy([...filesAdded, ...filesRemoved], file => file.programId);

  // get unique donor ids from filesAdded and filesRemoved:
  const programsUpdated: Program[] = [];

  Object.entries(filesUpdated).forEach(([programId, files]) => {
    const donorIds = new Set<string>();
    files.map(file => {
      donorIds.add(file.donorId);
    });
    const program: Program = {
      id: programId,
      donorsUpdated: Array.from(donorIds),
    };
    programsUpdated.push(program);
  });

  const message: PublicReleaseMessage = {
    id: release._id,
    publishedAt: <Date>release.publishedAt,
    label: <string>release.label,
    programs: programsUpdated,
  };

  return message;
}
