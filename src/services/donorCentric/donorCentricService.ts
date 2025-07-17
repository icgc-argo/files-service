/*
 * Copyright (c) 2025 The Ontario Institute for Cancer Research. All rights reserved
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

import donorCentricMapping from '../../resources/donor-centric-index-mapping.json';
import { getAppConfig } from '../../config';
import * as fileService from '../../data/files';
import * as clinical from '../../external/clinical';
import * as elasticsearch from '../../external/elasticsearch';
import { getAnalysesById, SongAnalysis } from '../../external/song';
import Logger from '../../logger';
import { AsyncResult, failure, success } from '../../types/Result';
import { buildDonorCentricDocument, DonorCentricDocument } from './donorCentricDocument';
import { ClinicalDonor } from '../../external/clinical/types';
const logger = Logger('DonorCentricService');

/**
 * Fetch source data for a donor to prepare the donor-centric document.
 *
 * This will first retrieve the clinical donor information and then pass this to the
 * `prepareDonorCentricDocument` function to complete building the document
 *
 * Donor documents require data from:
 * - File Manager DB (list of files, with ARGO specific IDs)
 * - Song (Analyses for donor)
 * - Clinical (Clinical data for donor)
 */
export async function prepareDonorCentricDocumentById(
	programId: string,
	donorId: string,
): AsyncResult<DonorCentricDocument, 'MISSING_CLINICAL_DATA' | 'SYSTEM_ERROR'> {
	try {
		// 1. fetch clinical data for donor
		const donor = await clinical.getDonor(programId, donorId);
		if (donor) {
			return prepareDonorCentricDocument(donor);
		}
		const errorMessage = `No clinical data was found for donor '${donorId}' from program '${programId}'.`;
		logger.info(`Unable to create donor centric document for ${donorId}.`, errorMessage);
		return failure('MISSING_CLINICAL_DATA', errorMessage);
	} catch (error) {
		logger.error(error);
		return failure('SYSTEM_ERROR', 'An unexpected error occurred while fetching data for the donor.');
	}
}

/**
 * Starting from a clinical donor record, this will collect the file information for the donor and build the
 * donor centric document
 *
 * Donor documents require data from:
 * - File Manager DB (list of files, with ARGO specific IDs)
 * - Song (Analyses for donor)
 */
export async function prepareDonorCentricDocument(
	donor: ClinicalDonor,
): AsyncResult<DonorCentricDocument, 'MISSING_CLINICAL_DATA' | 'SYSTEM_ERROR'> {
	try {
		const donorId = donor.donorId;
		const programId = donor.programId;
		// 1b. if donor is core complete, we can continue
		if (donor?.completionStats?.coreCompletionPercentage !== 1) {
			const errorMessage = `Donor ${donorId} does not meet the minimum clinical data submission requirements.`;
			logger.info(`Unable to create donor centric document for Donor ${donorId}.`, errorMessage);
			return failure('MISSING_CLINICAL_DATA', errorMessage);
		}

		// 2. fetch files for donor from db
		const files: fileService.File[] = [];
		try {
			const dbFiles = await fileService.getFiles({ include: { donors: [donorId] } });
			files.push(...dbFiles);
		} catch (error) {
			logger.warn(`Unable to fetch files from DB for donor '${donorId}'.`, error);
		}

		// 3. fetch analyses for donor from
		// Remove duplicate IDs by using Array.from(new Set)
		const analysisMap = files.reduce<Record<string, string>>((acc, file) => {
			acc[file.analysisId] = file.repoId;
			return acc;
		}, {});
		const analyses: SongAnalysis[] = [];

		for (const [analysisId, dataCenterId] of Object.entries(analysisMap)) {
			try {
				const analysis = await getAnalysesById({ dataCenterId, analysisId, studyId: programId });
				analyses.push(analysis);
			} catch (error) {
				logger.warn(`Unable to fetch data for analysis '${analysisId}'`);
			}
		}
		// build donor document
		const document = buildDonorCentricDocument({ donor, analyses, files });
		return success(document);
	} catch (error) {
		logger.error(error);
		return failure('SYSTEM_ERROR', 'An unexpected error occurred while fetching data for the donor.');
	}
}

// only create index once
let initialized = false;

/**
 * This will add or update a single donor document to the donor centric index in elasticsearch.
 *
 * @param document Donor centric document content to be indexed.
 * @param programId Currently unused, but may be necessary if documents need to be indexed into program specific indices.
 */
export async function indexDonorCentricDocument(document: DonorCentricDocument, programId: string): Promise<void> {
	const config = await getAppConfig();

	const { donorCentricIndexName } = config.elasticProperties;
	const esClient = await elasticsearch.getClient();

	if (!initialized) {
		// TODO: This should only happen once, on start up.
		await elasticsearch.createIndex(esClient, { indexName: donorCentricIndexName, mapping: donorCentricMapping });
		logger.info('Donor centric index initialized.');
		initialized = true;
	}
	const id = Array.isArray(document.donor_id)
		? document.donor_id[0]
		: document.donor_id
		? document.donor_id
		: undefined;
	await esClient.index({ index: donorCentricIndexName, id, body: document });
	logger.info(`Successfully indexed donor centric document for Donor ${id}`);
}

// TODO: Bulk write operation (accept an array of DonorCentric documents)
