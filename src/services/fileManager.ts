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
 * - TODO: Fetch analysis data from song to update file centric docs, initiated by build process to update Public indices.
 */

import _ from 'lodash';

import { File, FileInput, EmbargoStage, FileReleaseState } from '../data/files';
import { convertAnalysesToFileDocuments, RdpcFileDocument } from '../external/analysisConverter';

import * as fileService from '../data/files';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
import { getEmbargoStage } from './embargo';
import { Indexer } from './indexer';
import Logger from '../logger';
import { getDataCenter } from '../external/dataCenterRegistry';
import { getAnalysesById } from '../external/song';
import { streamToAsyncGenerator } from '../utils/streamToAsync';
const logger = Logger('FileManager');

export async function updateFileFromRdpcData(
  rdpcFileDocument: RdpcFileDocument,
  dataCenterId: string,
): Promise<File> {
  // Get or Create the file from the partialFile data
  let dbFile: File;
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
  dbFile = await fileService.getOrCreateFileByObjId(fileToCreate);

  // Update file if it has a changed status (publish date, unpublished/suppressed)
  const newStatus = rdpcFileDocument.analysis.analysisState;
  const newPublishDate = rdpcFileDocument.analysis.firstPublishedAt;
  if (dbFile.status !== newStatus || dbFile.firstPublished !== newPublishDate) {
    dbFile = await fileService.updateFileSongPublishStatus(rdpcFileDocument.objectId, {
      status: rdpcFileDocument.analysis.analysisState,
      firstPublished: rdpcFileDocument.analysis.firstPublishedAt,
    });
  }

  return recalculateFileState(dbFile);
}

type SaveAndIndexResults = {
  indexed: string[];
  removed: string[];
};
/**
 * Given RDPC File data, update file in DB
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
      const dbFile = await updateFileFromRdpcData(rdpcFile, dataCenterId);
      // convert to file centric documents
      return buildDocument({ dbFile, rdpcFile });
    }),
  );

  // Documents to add and remove from index
  const addDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState === 'PUBLISHED',
  );
  const removeDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState !== 'PUBLISHED',
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

export async function recalculateFileState(file: File) {
  // If the file is not already released, lets update its embargo stage
  const updates: any = {};
  const embargoStage = getEmbargoStage(file);
  if (file.releaseState === FileReleaseState.PUBLIC) {
    if (embargoStage !== EmbargoStage.PUBLIC) {
      // A currently public file has been calculated as needing to be restricted
      // Record the calculated embargoStage but the file remains correctly listed as releaseState = PUBLIC
      updates.embargoStage = embargoStage;
    }
  } else {
    // If this file is ready for PUBLIC access:
    //  - set the embargo stage to ASSOCIATE_ACCESS (2nd highest)
    //  - set the release state to queued
    if (embargoStage === EmbargoStage.PUBLIC) {
      updates.embargoStage = EmbargoStage.ASSOCIATE_ACCESS;
      updates.releaseState = FileReleaseState.QUEUED;
    } else {
      updates.embargoStage = embargoStage;
      updates.releaseState = FileReleaseState.RESTRICTED;
    }
  }

  if (updates.embargoStage !== file.embargoStage || updates.releaseState !== file.releaseState) {
    return await fileService.updateFileReleaseProperties(file.objectId, updates);
  }
  return file;
}

type RdpcSortedFiles = {
  dataCenterId: string;
  files: RdpcFileDocument[];
}[];
/**
 * Given a list of files, fetch the updated file data for them from song
 * This is important to updating Public indices during the release process
 *
 * Note that the files returned may not be PUBLISHED anymore
 * @param files
 * @returns
 */
export async function getRdpcDataForFiles(files: File[]): Promise<RdpcSortedFiles> {
  logger.info(`Preparing to fetch RDPC data for ${files.length} files`);

  const output: RdpcSortedFiles = [];

  // Group into DataCenters and RDPCs
  const dataCenters = _.groupBy(files, file => file.repoId);

  // For each data center, group into programs
  for (const dataCenterId in dataCenters) {
    // Collect analyses payloads from this data center
    const retrievedAnalyses: any[] = [];

    const dcFiles = dataCenters[dataCenterId];
    const dcData = await getDataCenter(dataCenterId);
    const dcUrl = dcData.url;
    const programs = _.groupBy(dcFiles, file => file.programId);

    // for each program, get the unique analysis IDs
    for (const programId in programs) {
      const dcProgramFiles = programs[programId];
      const analyses = _.uniq(dcProgramFiles.map(file => file.analysisId));

      logger.debug(
        `Fetching analyses by ID -- DC: ${dataCenterId} -- program: ${programId} -- analysisIds: ${analyses}`,
      );

      // Fetch data for each anaylsis ID
      for (const analysisId in analyses) {
        const analysis = await getAnalysesById(dcUrl, programId, analysisId);
        if (analysis !== undefined) {
          retrievedAnalyses.concat(analysis);
        }
      }
    }

    // convert analyses documents to rdpcFileDocs
    const rdpcFiles = await convertAnalysesToFileDocuments(retrievedAnalyses, dataCenterId);
    output.push({ dataCenterId, files: rdpcFiles });
  }

  return output;
}
