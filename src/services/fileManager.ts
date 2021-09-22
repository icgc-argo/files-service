import { isEmpty } from 'lodash';

import { File, FileInput, EmbargoStage, FileReleaseState } from '../data/files';
import { FilePartialDocument } from '../external/analysisConverter';

import * as fileService from '../data/files';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
import { getEmbargoStage } from './embargo';
import { Indexer } from './indexer';
import Logger from '../logger';
const logger = Logger('FileManager');

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
    dbFile = await fileService.updateFileSongPublishStatus(partialFile.objectId, {
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
    await filePartialDocuments.map(async filePartialDocument => {
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

  logger.debug(`START - Indexing/Removing files`);
  if (addDocuments.length) {
    await indexer.indexFileDocs(addDocuments);
  }
  if (removeDocuments.length) {
    await indexer.removeFileDocs(removeDocuments);
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
