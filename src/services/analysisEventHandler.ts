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
import { convertAnalysesToFileDocuments, FilePartialDocument } from '../external/analysisConverter';
import { AnalysisUpdateEvent } from '../external/kafka';
import { saveAndIndexFilesFromRdpcData } from './fileManager';
import { getIndexer } from './indexer';
const logger = Logger('AnalysisEventHandler');
/**
 * Song Kafka Message Handler
 * @param analysisEvent
 */
const analysisEventHandler = async (analysisEvent: AnalysisUpdateEvent) => {
  const analysis = analysisEvent.analysis;
  const dataCenterId = analysisEvent.songServerId;

  logger.info(
    `START - processing song analysis event from data-center ${dataCenterId} for analysisId ${analysis.analysisId}}`,
  );

  const partialDocuments = await convertAnalysesToFileDocuments([analysis], dataCenterId);
  logger.debug('converted to files');

  const indexer = await getIndexer();
  const response = await saveAndIndexFilesFromRdpcData(partialDocuments, dataCenterId, indexer);
  await indexer.release();
  logger.info(
    `DONE - processing song analysis event from data-center ${dataCenterId} for analysisId ${analysis.analysisId}}`,
  );
  return response;
};
export default analysisEventHandler;
