import { envParameters, getAppConfig } from '../config';
import * as fileService from '../data/files';

import PromisePool from '@supercharge/promise-pool/dist';
import ClinicalUpdateEvent from '../external/kafka/messages/ClinicalUpdateEvent';
import { updateFileFromExternalSources } from '../services/fileManager';
import { getIndexer } from '../services/indexer';
import { isUnreleased } from '../services/utils/fileUtils';

import Logger from '../logger';
const logger = Logger('Job:ProcessClinicalEvent');

/**
 * Clinical Data Update Event Processor
 * @param clinicalEvent
 */
const clinicalUpdateEvent = async (clinicalEvent: ClinicalUpdateEvent): Promise<void> => {
  try {
    const { programId, donorIds } = clinicalEvent;
    const config = await getAppConfig();
    logger.info(
      `START - processing clinical data update event for program ${programId} including ${donorIds?.length ||
        0} donors`,
    );

    const indexer = await getIndexer();

    // get files for donors
    const files = await fileService.getFiles({ include: { donors: donorIds } });
    // we only need to do state updates for unreleased files
    const unreleasedFiles = files.filter(isUnreleased);

    // for each file check if they should be released and then reindex
    await PromisePool.withConcurrency(
      // This loop fetches data for the analysis from song/clinical/rdpc-gateway, and then indexes the results
      // so max concurrency should be the min of our concurrency limit for those actions
      Math.min(
        envParameters.concurrency.elasticsearch.maxDocumentUpdates,
        envParameters.concurrency.song.maxAnalysisRequests,
      ),
    )
      .for(unreleasedFiles)
      .handleError((e, file) => {
        logger.error(`Update Doc Error for file "${file.fileId}": ${e}`);
      })
      .process(async file => {
        const updatedFile = await updateFileFromExternalSources(file);

        if (updatedFile.releaseState !== fileService.FileReleaseState.UNRELEASED) {
          indexer.updateRestrictedFile(updatedFile);
        }
      });

    logger.info(`DONE - processing clinical data update event for program ${programId}`);
  } catch (e) {
    logger.error(`FAILURE - processing clinical data update event failed`, e);
  }
};
export default clinicalUpdateEvent;
