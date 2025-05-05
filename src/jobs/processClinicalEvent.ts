import { getAppConfig } from '../config';
import * as fileService from '../data/files';

import PromisePool from '@supercharge/promise-pool/dist';
import ClinicalUpdateEvent from '../external/kafka/messages/ClinicalUpdateEvent';
import { updateFileFromExternalSources } from '../services/fileManager';
import { getFileCentricIndexer } from '../services/fileCentricIndexer';
import { isUnreleased } from '../services/utils/fileUtils';

import Logger from '../logger';
import {
	indexDonorCentricDocument,
	prepareDonorCentricDocumentById,
} from '../services/donorCentric/donorCentricService';
const logger = Logger('Job:ProcessClinicalEvent');

async function updateDonorCentricIndexForDonor(donorId: string, programId: string): Promise<void> {
	try {
		const result = await prepareDonorCentricDocumentById(programId, donorId);

		if (result.success) {
			await indexDonorCentricDocument(result.data, programId);
		}
	} catch (error) {
		logger.warn(`Failed to update donor centric index for donor '${donorId}' in program '${programId}'.`);
	}
}

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

		// ====================================================================
		//   1. Update files centric documents belonging to the listed donors
		// ====================================================================

		const indexer = await getFileCentricIndexer();

		// get files for donors
		const files = await fileService.getFiles({ include: { donors: donorIds } });
		// we only need to do state updates for unreleased files
		const unreleasedFiles = files.filter(isUnreleased);

		// for each file check if they should be released and then reindex
		await PromisePool.withConcurrency(5)
			.for(unreleasedFiles)
			.handleError((e, file) => {
				logger.error(`Update Doc Error: ${e}`);
				logger.error(`Update Doc Error: ${e.stack}`);
			})
			.process(async file => {
				const updatedFile = await updateFileFromExternalSources(file);

				if (updatedFile.releaseState !== fileService.FileReleaseState.UNRELEASED) {
					indexer.updateRestrictedFile(updatedFile);
				}
			});

		// ====================================================================
		//   2. Update donor centric documents for each listed donors
		// ====================================================================

		for (const donorId of donorIds || []) {
			await updateDonorCentricIndexForDonor(donorId, programId);
		}

		await logger.info(`DONE - processing clinical data update event for program ${programId}`);
	} catch (e) {
		logger.error(`FAILURE - processing clinical data update event failed`, e);
	}
};
export default clinicalUpdateEvent;
