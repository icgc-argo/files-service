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

import logger from '../logger';
import { convertAnalysesToFileDocuments } from '../external/analysisConverter';
import { getDataCenter } from '../external/dataCenterRegistry';
import { getStudies, getAnalysesBatchesStream } from '../external/song';
import { streamToAsyncGenerator } from '../utils/streamToAsync';
import { indexAnalyses } from './manager';

export async function processReindexRequest(dataCenterId: string) {
  try {
    logger.info(`indexing repo ${dataCenterId}`);
    const { url } = await getDataCenter(dataCenterId);
    logger.info(url);
    const studies: string[] = await getStudies(url);
    logger.info(`fetched all studies, count: ${studies?.length}`);

    for (const study of studies) {
      try {
        logger.info(`indexing study: ${study}`);
        const analysesStream = await generateStudyAnalyses(url, study);
        for await (const analyses of analysesStream) {
          logger.info(
            `data =>>>>>> ${JSON.stringify(analyses.map((kv: any) => kv.value.analysisId))}`,
          );
          const analysesObject = analyses.map((a: any) => a.value);
          const files = await convertAnalysesToFileDocuments(analysesObject, dataCenterId);
          await indexAnalyses(files, dataCenterId);
        }
      } catch (err) {
        logger.error(`failed to index study ${study}, ${err}`, err);
      }
    }
  } catch (err) {
    logger.error(`error while indexing repository ${dataCenterId}`);
    throw err;
  }
  logger.info(`done indexing`);
}

async function generateStudyAnalyses(url: string, studyId: string) {
  const pipeline = await getAnalysesBatchesStream(url, studyId);
  // read one batch entry at a time
  return streamToAsyncGenerator<any>(pipeline, 1);
}
