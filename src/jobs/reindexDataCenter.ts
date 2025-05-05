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

import { convertAnalysesToFileDocuments } from '../external/analysisConverter';
import { getDataCenter } from '../external/dataCenterRegistry';
import { getAnalysesByStudy, getStudies } from '../external/song';
import Logger from '../logger';
import { getFileCentricIndexer } from '../services/fileCentricIndexer';
import { saveAndIndexFilesFromRdpcData } from '../services/fileManager';
const logger = Logger('Job:ReindexDataCenter');

/**
 * Fetch all analysis data from a given data center and use this data to make sure all files are up to date
 * in DB and in ES
 *
 * A list of study IDS can be provided in the studyFilter to limit which studies are indexed.
 * @param dataCenterId
 * @param studyFilter
 */
async function reindexDataCenter(dataCenterId: string, studyFilter: string[]) {
	try {
		logger.info(`Start: reindex data center ${dataCenterId}`);
		const { songUrl } = await getDataCenter(dataCenterId);
		logger.info(`Datacenter URL: ${songUrl}`);
		const studies: string[] = await getStudies(songUrl);
		const filteredStudies: string[] =
			studyFilter.length > 0 ? studies.filter(study => studyFilter.includes(study)) : studies;

		const indexer = await getFileCentricIndexer();
		await indexer.createEmptyRestrictedIndices(filteredStudies);

		for (const studyId of filteredStudies) {
			logger.info(`Indexing study: ${studyId}`);

			try {
				const analysesResponseGenerator = getAnalysesByStudy({ dataCenterId, studyId });
				for await (const analyses of analysesResponseGenerator) {
					const analysisIds = analyses.map(analysis => analysis.analysisId);
					logger.debug(`Retrieved analyses from song: ${analysisIds}`);

					const files = await convertAnalysesToFileDocuments(analyses, dataCenterId);
					await saveAndIndexFilesFromRdpcData(files, dataCenterId, indexer);
				}
				logger.info(`Done indexing study: ${studyId}`);
			} catch (err) {
				logger.error(`Failed to index study ${studyId}, ${err}`, err);
			}
		}

		// Release all file updates.
		await indexer.release();
		logger.info(`Done re-indexing data center`);
	} catch (err) {
		logger.error(`Error while indexing repository ${dataCenterId}`);
		throw err;
	}
}

export default reindexDataCenter;
