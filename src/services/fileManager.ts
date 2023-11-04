/*
 * Copyright (c) 2023 The Ontario Institute for Cancer Research. All rights reserved
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

/**
 * FileManager is responsible for maintaining the state of Files in the DB and syncing that content to ElasticSearch.
 * The content stored in the DB is only a subset of the file data, the relevant data to fetch the full file data from
 * an RDPC, plus details relevant to calculating the embargo stage and release state of the file.
 *
 * Before indexing a file, they need to be built into a FileCentricDocument (via the FileCentricDocument service) by
 * combining the DB File data with RDPC file data. There are 4 ways these updates are made:
 * - Song Analysis event received from Kafka that contains RDPC analysis data (processAnalysisEvent)
 * - Sync Data with RDPC event fetches all analysis from an RDPC (processDataSyncRequest)
 * - Release.build takes the FileCentricDocument from an existing index and copies it into Public indices
 */

import PromisePool from '@supercharge/promise-pool/dist';
import _ from 'lodash';

import * as fileService from '../data/files';
import { File, FileInput, EmbargoStage, FileReleaseState } from '../data/files';
import * as analysisConverter from '../external/analysisConverter';
import { RdpcFileDocument } from '../external/analysisConverter';
import * as clinical from '../external/clinical';
import * as song from '../external/song';
import { SongAnalysis } from '../external/song';
import { ANALYSIS_STATUS } from '../utils/constants';
import * as dcGateway from '../external/dataCenterGateway';
import { calculateEmbargoStage, calculateEmbargoStartDate } from './embargo';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
import { Indexer } from './indexer';

import Logger from '../logger';
import { envParameters } from '../config';
const logger = Logger('FileManager');

export async function getOrCreateFileFromRdcData(
  rdpcFileDocument: RdpcFileDocument,
  dataCenterId: string,
): Promise<File> {
  const fileToCreate: FileInput = {
    analysisId: rdpcFileDocument.analysis.analysisId,
    objectId: rdpcFileDocument.objectId,
    programId: rdpcFileDocument.studyId,
    repoId: dataCenterId,

    status: rdpcFileDocument.analysis.analysisState,

    donorId: rdpcFileDocument.donors[0].donorId,

    firstPublished: rdpcFileDocument.analysis.firstPublishedAt,

    labels: [],
  };
  return await fileService.getOrCreateFileByObjId(fileToCreate);
}

export async function updateStatusFromRdpcData(file: File, rdpcFileDocument: RdpcFileDocument): Promise<File> {
  // Update relevant properties from RDPC
  const status = rdpcFileDocument.analysis.analysisState;
  if (status !== file.status) {
    // Update the status of the object and in the DB
    await fileService.updateFileSongPublishStatus(rdpcFileDocument.objectId, {
      status: rdpcFileDocument.analysis.analysisState,
    });
    file.status = rdpcFileDocument.analysis.analysisState;
  }

  return file;
}

type SaveAndIndexResults = {
  indexed: string[];
  removed: string[];
};
/**
 * Given RDPC File data, update file in DB and Restricted Index
 * @param rdpcFileDocs
 * @param dataCenterId
 * @param indexer
 * @returns {SaveAndIndexResults}
 */
export async function saveAndIndexFilesFromRdpcData(
  rdpcFileDocs: RdpcFileDocument[],
  dataCenterId: string,
  indexer: Indexer,
): Promise<SaveAndIndexResults> {
  const fileCentricDocuments = await Promise.all(
    await rdpcFileDocs.map(async rdpcFile => {
      // update local records
      const createdFile = await getOrCreateFileFromRdcData(rdpcFile, dataCenterId);
      const partialUpdate = await updateStatusFromRdpcData(createdFile, rdpcFile);
      const updatedFile = await updateFileFromExternalSources(partialUpdate);

      // convert to file centric documents
      return buildDocument({ dbFile: updatedFile, rdpcFile });
    }),
  );

  // Documents to add and remove from index
  const addDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState === ANALYSIS_STATUS.PUBLISHED,
  );
  const removeDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState !== ANALYSIS_STATUS.PUBLISHED,
  );

  logger.debug(`START - Indexing/Removing files`);
  if (addDocuments.length) {
    await indexer.indexRestrictedFileDocs(addDocuments);
  }
  if (removeDocuments.length) {
    await indexer.removeRestrictedFileDocs(removeDocuments);
  }

  logger.debug(`DONE - Indexing/Removing files`);

  // Note: the indexed documents have had all property keys converted to snake case so use .object_id to ID them
  return {
    indexed: addDocuments.map(doc => doc.object_id),
    removed: removeDocuments.map(doc => doc.object_id),
  };
}

/**
 * Return the embargo start date of the file, or calculate it if necessary.
 * @param file
 * @returns
 */
export async function getOrCheckFileEmbargoStart(file: File): Promise<Date | undefined> {
  if (file.embargoStart) {
    return file.embargoStart;
  }

  // File does not have a start date recorded, so we will calculate. We need to make requests to fetch:
  //  - matchedSamplePair from data center gateway
  //  - analysis from Song
  //  - donor from clinical (to confirm the completion stats)

  try {
    // TODO: The following requests need to be cached, otherwise they will be called repeatedly. Since file processing is being done in parallel and there are multiple files per donor
    const matchedSamplePairs = await dcGateway.getMatchedPairsForDonor(file.donorId);
    const songAnalysis = await song.getAnalysesById(file.repoId, file.programId, file.analysisId);
    const clinicalDonor = await clinical.getDonor(file.programId, file.donorId);

    const startDate = await calculateEmbargoStartDate({
      dbFile: file,
      matchedSamplePairs,
      songAnalysis,
      clinicalDonor,
    });
    if (startDate) {
      logger.info(`An embargoStartDate has been found for file ${file.fileId}: ${startDate}`);
    }
    return startDate;
  } catch (e) {
    logger.error(`Failure fetching source data while checking file's embargo start date`, e);
  }
}

/**
 * Calculate embargoStart date, embargoStage, and releaseState for the file, save to DB,
 * and return the file with any changes.
 * @param file
 * @returns
 */
export async function updateFileEmbargoState(file: File): Promise<File> {
  // Check for embargoStart date, if not present  attempt to calculate it

  // Recalculate embargoStage
  const updates: { embargoStart?: Date; embargoStage?: EmbargoStage; releaseState?: FileReleaseState } = {};
  updates.embargoStart = await getOrCheckFileEmbargoStart(file);

  // If an unreleased file has noembargo start date, we don't need to continue. The file will remain unrealeased.
  if (!updates.embargoStart && file.releaseState === FileReleaseState.UNRELEASED) {
    return file;
  }

  // we need to store the original start date so we can compare with the update object at the end (for saving changes to DB)
  //  but we also need to add the embargo start date to the file object to use it when calculating the embargo stage
  const originalEmbargoStart = file.embargoStart;
  file.embargoStart = updates.embargoStart;

  const embargoStage = calculateEmbargoStage(file);
  switch (file.releaseState) {
    case FileReleaseState.PUBLIC:
      if (embargoStage !== EmbargoStage.PUBLIC) {
        // A currently public file has been calculated as needing to be restricted
        // Record the calculated embargoStage but the file remains correctly listed as releaseState = PUBLIC
        logger.debug(
          'updateFileEmbargoState()',
          file.fileId,
          `PUBLIC file embargo calculated to be`,
          embargoStage,
          'Setting release state to',
          FileReleaseState.QUEUED_TO_RESTRICT,
        );
        updates.releaseState = FileReleaseState.QUEUED_TO_RESTRICT;
      }
      break;
    case FileReleaseState.QUEUED_TO_RESTRICT:
      // File is queued for restricted, so if embargo stage is calculated as public we can just return this file to PUBLIC state
      // Otherwise, it is in the right stage and there is nothing to do.
      if (embargoStage === EmbargoStage.PUBLIC) {
        updates.releaseState = FileReleaseState.PUBLIC;
      }
      break;
    case FileReleaseState.UNRELEASED:
    case FileReleaseState.RESTRICTED:
    case FileReleaseState.QUEUED_TO_PUBLIC:
      // Currently restricted files, default promotion logic
      if (embargoStage === EmbargoStage.PUBLIC) {
        // Cant push a file to PUBLIC except during a release, so mark as queued to public
        updates.embargoStage = EmbargoStage.ASSOCIATE_ACCESS;
        updates.releaseState = FileReleaseState.QUEUED_TO_PUBLIC;
      } else if (embargoStage === EmbargoStage.UNRELEASED) {
        updates.embargoStage = embargoStage;
        updates.releaseState = FileReleaseState.UNRELEASED;
      } else {
        updates.embargoStage = embargoStage;
        updates.releaseState = FileReleaseState.RESTRICTED;
      }
      break;
  }

  if (
    (updates.embargoStage && updates.embargoStage !== file.embargoStage) ||
    (updates.embargoStart && updates.embargoStart !== originalEmbargoStart) ||
    (updates.releaseState && updates.releaseState !== file.releaseState)
  ) {
    return await fileService.updateFileReleaseProperties(file.objectId, updates);
  }
  return file;
}

/**
 * Check with clinical service if the file has had clinical data added, update the file, save to the DB
 * and return the file with any changes.
 * @param file
 * @returns
 */
export async function updateFileClinicalData(file: File): Promise<File> {
  if (file.hasClinicalData) {
    // File already known to have clinical data, no changes necessary
    return file;
  }

  try {
    const donorData = await clinical.getDonor(file.programId, file.donorId);
    if (donorData?.completionStats?.coreCompletionPercentage === 1) {
      return await fileService.updateFileHasClinicalData(file.objectId, true);
    }
  } catch (error) {
    logger.warn(`Failed to update file clinical data record`, file.programId, file.donorId, error);
  }
  return file;
}

/**
 * Checks external sources for updates to file embargo state and clinical data state.
 * This applies the following set of update functions:
 *  - updateFileEmbargoState
 *  - updateFileClinicalData
 *
 * The file is updated and saved to the DB and then the updated File is returned
 * @param file
 */
export async function updateFileFromExternalSources(file: File): Promise<File> {
  // TODO: The functions called here could use a refactoring to not perform DB updates in each step. We don't need the partial updates.
  const partialUpdate = await updateFileEmbargoState(file);
  return await updateFileClinicalData(partialUpdate);
}

type RdpcResultPair = {
  file: File;
  rdpcFile?: RdpcFileDocument;
};
type SortedRdpcResults = {
  dataCenterId: string;
  results: RdpcResultPair[];
}[];

/**
 * Given a list of files, fetch the updated file data for them from song
 * This is the data fetching step for updating db files from data center
 *
 * Note that the files returned may not be PUBLISHED, they could be in UNPUBLISHED or SUPPRESSED state
 * @param files
 * @returns
 */
export async function getRdpcDataForFiles(files: File[]): Promise<SortedRdpcResults> {
  logger.info(`Preparing to fetch RDPC data for ${files.length} files`);

  const output: SortedRdpcResults = [];

  // Group into DataCenters and RDPCs
  const dataCenters = _.groupBy(files, file => file.repoId);

  // For each data center, group into programs
  for (const dataCenterId in dataCenters) {
    // Collect analyses payloads from this data center
    const retrievedAnalyses: SongAnalysis[] = [];

    const dcFiles = dataCenters[dataCenterId];

    const programs = _.groupBy(dcFiles, file => file.programId);

    // for each program, get the unique analysis IDs
    for (const programId in programs) {
      const dcProgramFiles = programs[programId];
      const analyses = _.uniq(dcProgramFiles.map(file => file.analysisId));

      logger.debug(
        `Fetching analyses by ID -- DC: ${dataCenterId} -- program: ${programId} -- analysis count: ${analyses.length}`,
      );

      // Fetch data for each anaylsis ID
      await PromisePool.withConcurrency(envParameters.concurrency.song.maxAnalysisRequests)
        .for(analyses)
        .process(async analysisId => {
          const analysis = await song.getAnalysesById(dataCenterId, programId, analysisId);
          retrievedAnalyses.push(analysis);
        });
    }
    // convert analyses documents to rdpcFileDocs
    const rdpcFiles = await analysisConverter.convertAnalysesToFileDocuments(retrievedAnalyses, dataCenterId);

    // Pair up the files in this data center with the rdpcFiles returned from maestro
    const results: RdpcResultPair[] = dcFiles.map(file => {
      const rdpcFile = rdpcFiles.find(rdpcFile => file.objectId === rdpcFile.objectId);
      return { file, rdpcFile };
    });
    logger.debug(
      `Successfully retrieved ${results.filter(result => result.rdpcFile).length} rdpc files from ${dataCenterId} for ${
        dcFiles.length
      } input files`,
    );
    output.push({ dataCenterId, results });
  }

  return output;
}

/**
 * Given a list of files from the DB, fetch the latest data from their data center
 * The DB will be updated with changes retrieved, and then documents will be prepared for indexing
 *
 * This will recalculate their embargo stage and release status and set this in the DB
 *
 * Note that the updates will include UNPUBLISHED and SUPPRESSED files, so they need to be filtered by state before indexing.
 * @param files
 * @returns
 */
export async function fetchFileUpdatesFromDataCenter(files: File[]): Promise<FileCentricDocument[]> {
  const rdpcSortedResults = await getRdpcDataForFiles(files);

  const output: FileCentricDocument[] = [];

  for (const rdpcData of rdpcSortedResults) {
    const rdpcFilePairs = rdpcData.results;
    await PromisePool.withConcurrency(
      Math.min(
        envParameters.concurrency.elasticsearch.maxDocumentUpdates,
        envParameters.concurrency.song.maxAnalysisRequests,
      ),
    )
      .for(rdpcFilePairs) // For each file doc retrieved from that rdpc
      .process(async resultPair => {
        if (resultPair.rdpcFile) {
          const dbFile = await updateStatusFromRdpcData(resultPair.file, resultPair.rdpcFile);
          const fileCentricDoc = buildDocument({ dbFile, rdpcFile: resultPair.rdpcFile });
          output.push(fileCentricDoc);
        } else {
          logger.warn(`Unable to retrieve RDPC data for ${resultPair.file.objectId}`);
        }
      });
  }
  return output;
}
