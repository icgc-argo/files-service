import { getAppConfig } from '../config';
import * as fileService from '../data/files';

import PromisePool from '@supercharge/promise-pool/dist';
import { recalculateFileState } from '../services/fileManager';
import { getIndexer } from '../services/indexer';
import { isUnreleased } from '../services/utils/fileUtils';
import ClinicalUpdateEvent from '../external/kafka/messages/ClinicalUpdateEvent';

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
    PromisePool.withConcurrency(5)
      .for(unreleasedFiles)
      .handleError((e, file) => {
        logger.error(`Update Doc Error: ${e}`);
        logger.error(`Update Doc Error: ${e.stack}`);
      })
      .process(async file => {
        const updatedFile = await recalculateFileState(file);

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
