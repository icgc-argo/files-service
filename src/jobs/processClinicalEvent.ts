import { getAppConfig } from '../config';
import ClinicalUpdateEvent from '../external/kafka/messages/ClinicalUpdateEvent';

import Logger from '../logger';
const logger = Logger('Job:ProcessClinicalEvent');

/**
 * Clinical Data Update Event Processor
 * @param clinicalEvent
 */
const clinicalUpdateEvent = async (clinicalEvent: ClinicalUpdateEvent) => {
  const { programId, donorIds } = clinicalEvent;
  const config = await getAppConfig();
  if (config.features.clinicalDataIndexing) {
    logger.info(
      `START - processing clinical data update event for program ${programId} including ${donorIds?.length ||
        0} donors`,
    );

    logger.info(`DONE - processing clinical data update event for program ${programId}`);
  } else {
    logger.info(
      `DISABLED - no processing performed for clinical update event. Event is for program ${programId} including ${donorIds?.length ||
        0} donors`,
    );
  }
};
export default clinicalUpdateEvent;
