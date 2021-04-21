import { isEmpty } from 'lodash';

import { File, FileInput, EmbargoStage, ReleaseState } from '../data/files';
import { FilePartialDocument } from '../external/analysisConverter';

import * as fileService from '../data/files';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
import { getEmbargoStage } from './embargo';
import { getIndexer, Indexer } from './indexer';
import logger from '../logger';

export async function updateFileFromRdpcData(
  partialFile: FilePartialDocument,
  dataCenterId: string,
): Promise<File> {
  // Get or Create the file from the partialFile data
  let dbFile: File;
  const fileToCreate: FileInput = {
    analysisId: partialFile.analysis.analysisId,
    objectId: partialFile.objectId,
    programId: partialFile.studyId,
    repoId: dataCenterId,

    status: partialFile.analysis.analysisState,

    donorId: partialFile.donors[0].donorId,

    firstPublished: partialFile.analysis.firstPublishedAt,

    labels: [],
  };
  dbFile = await fileService.getOrCreateFileByObjId(fileToCreate);

  // Update file if it has a changed status (publish date, unpublished/suppressed)
  const newStatus = partialFile.analysis.analysisState;
  const newPublishDate = partialFile.analysis.firstPublishedAt;
  if (dbFile.status !== newStatus || dbFile.firstPublished !== newPublishDate) {
    dbFile = await fileService.updateFilePublishStatus(partialFile.objectId, {
      status: partialFile.analysis.analysisState,
      firstPublished: partialFile.analysis.firstPublishedAt,
    });
  }

  return recalculateFileState(dbFile);
}

type SaveAndIndexResults = {
  indexed: string[];
  removed: string[];
};
export async function saveAndIndexFilesFromRdpcData(
  filePartialDocuments: FilePartialDocument[],
  dataCenterId: string,
  indexer: Indexer,
): Promise<SaveAndIndexResults> {
  const fileCentricDocuments = await Promise.all(
    filePartialDocuments.map(async filePartialDocument => {
      // update local records
      const dbFile = await updateFileFromRdpcData(filePartialDocument, dataCenterId);
      // convert to file centric documents
      return buildDocument({ dbFile, filePartialDocument });
    }),
  );

  // Documents to add and remove from index
  const addDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState === 'PUBLISHED',
  );
  const removeDocuments: FileCentricDocument[] = fileCentricDocuments.filter(
    doc => doc.analysis?.analysisState !== 'PUBLISHED',
  );

  if (addDocuments.length) {
    await indexer.indexFiles(addDocuments);
  }
  if (removeDocuments.length) {
    await indexer.removeFiles(removeDocuments);
  }

  // Note: the indexed documents have had all property keys converted to snake case,
  //       so file_id for indexed docs and fileId for removed docs
  return {
    indexed: addDocuments.map(doc => doc.objectId),
    removed: removeDocuments.map(doc => doc.fileId),
  };
}

export async function recalculateFileState(file: File) {
  // If the file is not already released, lets update its embargo stage
  const updates: any = {};
  if (file.releaseState !== ReleaseState.PUBLIC) {
    const embargoStage = getEmbargoStage(file);

    // If this file is ready for PUBLIC access:
    //  - set the embargo stage to ASSOCIATE_ACCESS (2nd highest)
    //  - set the release state to queued
    if (embargoStage === EmbargoStage.PUBLIC) {
      updates.embargoStage = EmbargoStage.ASSOCIATE_ACCESS;
      updates.releaseState = ReleaseState.QUEUED;
    } else {
      updates.embargoStage = embargoStage;
      updates.releaseState = ReleaseState.RESTRICTED;
    }
  }

  if (updates.embargoStage !== file.embargoStage && updates.releaseState !== file.releaseState) {
    logger.info(`Updating file embargo stage: ${file.fileId} - ${JSON.stringify(updates)}`);
    return await fileService.updateFileReleaseProperties(file.objectId, updates);
  }
  return file;
}
