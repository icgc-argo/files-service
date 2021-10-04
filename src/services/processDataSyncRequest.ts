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

import Logger from '../logger';
import { convertAnalysesToFileDocuments } from '../external/analysisConverter';
import { getDataCenter } from '../external/dataCenterRegistry';
import { getStudies, getAnalysesBatchesStream } from '../external/song';
import { streamToAsyncGenerator } from '../utils/streamToAsync';
import { saveAndIndexFilesFromRdpcData } from './fileManager';
import { getIndexer } from './indexer';
const logger = Logger('Process.DataSync');

export async function reindexDataCenter(dataCenterId: string, studyFilter: string[]) {
  try {
    logger.info(`Start: reindex data center ${dataCenterId}`);
    const { url } = await getDataCenter(dataCenterId);
    logger.info(`Datacenter URL: ${url}`);
    const studies: string[] = await getStudies(url);

    const indexer = await getIndexer();

    for (const study of studies) {
      if (studyFilter.length > 0 && !studyFilter.includes(study)) {
        // Skip studies not in our requested list
        logger.debug(`Skipping study not included in re-index request: ${study}`);
        continue;
      }
      logger.info(`Indexing study: ${study}`);
      try {
        const analysesStream = await generateStudyAnalyses(url, study);
        for await (const analysesData of analysesStream) {
          const analyses = analysesData.map((a: { value: any }) => a.value);
          const analysisIds = analyses.map((a: { analysisId: string }) => a.analysisId);
          logger.info(`Retrieved analyses from song: ${analysisIds}`);

          const files = await convertAnalysesToFileDocuments(analyses, dataCenterId);
          await saveAndIndexFilesFromRdpcData(files, dataCenterId, indexer);
        }
        logger.info(`Done indexing study: ${study}`);
      } catch (err) {
        logger.error(`Failed to index study ${study}, ${err}`, err);
      }
    }

    // Release all file updates.
    await indexer.release();
  } catch (err) {
    logger.error(`Error while indexing repository ${dataCenterId}`);
    throw err;
  }
  logger.info(`Done indexing`);
}

async function generateStudyAnalyses(url: string, studyId: string) {
  const pipeline = await getAnalysesBatchesStream(url, studyId);
  // read one batch entry at a time
  return streamToAsyncGenerator<any>(pipeline, 1);
}
