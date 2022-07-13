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
import AnalysisUpdateEvent from '../external/kafka/messages/AnalysisUpdateEvent';
import { convertAnalysesToFileDocuments } from '../external/analysisConverter';
import { saveAndIndexFilesFromRdpcData } from '../services/fileManager';
import { isRestricted } from '../services/utils/fileUtils';
import { getIndexer } from '../services/indexer';
import * as fileService from '../data/files';
import PromisePool from '@supercharge/promise-pool';

import Logger from '../logger';
const logger = Logger('Job:ProcessAnalysisEvent');

async function handleSongPublishedAnalysis(analysis: any, dataCenterId: string) {
  const rdpcFileDocuments = await convertAnalysesToFileDocuments([analysis], dataCenterId);
  const indexer = await getIndexer();
  await saveAndIndexFilesFromRdpcData(rdpcFileDocuments, dataCenterId, indexer);
  await indexer.release();
}

/**
 * This handles all analysis events from song that have the state different than PUBLISHED.
 * This includes UNPUBLISHED and SUPPRESSED, but neither makes a difference here. Just PUBLISHED and NOT-PUBLISHED.
 * @param analysisId
 * @param status
 */
async function handleSongUnpublishedAnalysis(analysisId: string, status: string) {
  // Get files based on analysis ID
  const files = await fileService.getFilesByAnalysisId(analysisId);
  if (files.length === 0) {
    logger.info(`No stored files for analysis ${analysisId}. No processing to do.`);
  }
  logger.info(`Updating Song status to ${status} for files ${files.map(file => file.objectId)}`);
  await PromisePool.withConcurrency(10)
    .for(files)
    .handleError((error, file) => {
      logger.error(`Failure updating file ${file.objectId} status to ${status}: ${error}`);
    })
    .process(async file => {
      await fileService.updateFileSongPublishStatus(file.objectId, { status });
    });

  // Remove these files from the restricted indices
  const restrictedFiles = files.filter(isRestricted);
  if (restrictedFiles.length) {
    const indexer = await getIndexer();
    await indexer.removeFilesFromRestricted(files);
    await indexer.release();
  }
}

/**
 * Song Kafka Message Handler
 * @param analysisEvent
 */
const processAnalysisEvent = async (analysisEvent: AnalysisUpdateEvent) => {
  const { analysis, analysisId, state, songServerId } = analysisEvent;

  logger.info(
    `START - processing song analysis event from data-center ${songServerId} for analysisId ${analysisId} with state ${state}`,
  );

  if (state === 'PUBLISHED') {
    await handleSongPublishedAnalysis(analysis, songServerId);
  } else {
    // Unpublish or Suppress
    await handleSongUnpublishedAnalysis(analysisId, state);
  }

  logger.info(
    `DONE - processing song analysis event from data-center ${songServerId} for analysisId ${analysis.analysisId}`,
  );
};
export default processAnalysisEvent;
