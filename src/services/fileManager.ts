import { isEmpty } from 'lodash';

import { File, FileInput, EmbargoStage, ReleaseState } from '../data/files';
import { FilePartialDocument } from '../external/analysisConverter';

import * as fileService from '../data/files';
import { buildDocument, FileCentricDocument } from './fileCentricDocument';
import { getEmbargoStage } from './embargo';
import * as indexer from './indexer';
import logger from '../logger';

export async function updateFile(
  partialFile: FilePartialDocument,
  dataCenterId: string,
): Promise<File> {
  // Get or Create the file from the partialFile data
  let dbFile: File;
  try {
    dbFile = await fileService.getFileByObjId(partialFile.objectId);
  } catch (e) {
    logger.debug(
      `updateFile found no existing file in db for ${partialFile.objectId} . Will create file instead.`,
    );
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
  }

  // If not already released, lets update its embargo stage
  const updates: any = {};
  if (dbFile.releaseState !== ReleaseState.PUBLIC) {
    const embargoStage = getEmbargoStage(partialFile.analysis.firstPublishedAt);

    // If this file is ready for PUBLIC access:
    //  - set the embargo stage to ASSOCIATE_ACCESS (2nd highest)
    //  - set the release state to queued
    if (embargoStage === EmbargoStage.PUBLIC) {
      updates.embargoStage = EmbargoStage.ASSOCIATE_ACCESS;
      updates.releaseState = ReleaseState.QUEUED;
    } else {
      updates.embargoStage = embargoStage;
    }
  }

  return isEmpty(updates)
    ? dbFile
    : await fileService.updateFileReleaseProperties(dbFile.objectId, updates);
}

export async function saveAndIndexFiles(
  filePartialDocuments: FilePartialDocument[],
  dataCenterId: string,
): Promise<void> {
  const fileCentricDocuments = await Promise.all(
    filePartialDocuments.map(async filePartialDocument => {
      // update local records
      const dbFile = await updateFile(filePartialDocument, dataCenterId);
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

  await indexer.index(addDocuments);
  await indexer.remove(removeDocuments);
}
