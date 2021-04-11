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

import { convertAnalysisToFileDocuments, FileCentricDocument } from '../external/analysisConverter';
import { AnalysisUpdateEvent } from '../external/kafka';

import * as indexer from './indexer';
import * as fileService from '../data/files';
import { File, EmbargoStage, ReleaseState } from '../data/files';
import { getDataCenter } from '../external/dataCenterRegistry';
import { getStudies, getAnalysesBatchesStream } from '../external/song';
import { streamToAsyncGenerator } from '../utils/streamToAsync';

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
          await indexAnalyses(analysesObject, dataCenterId);
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

export async function handleAnalysisPublishEvent(analysisEvent: AnalysisUpdateEvent) {
  const analysis = analysisEvent.analysis;
  const dataCenterId = analysisEvent.songServerId;
  return await indexAnalyses([analysis], dataCenterId);
}

async function indexAnalyses(analyses: any[], dataCenterId: string) {
  // get genomic files for an analysis
  const filesByAnalysisId = await convertAnalysisToFileDocuments(analyses, dataCenterId);
  let files: FileCentricDocument[] = [];

  // get the file docs arrays from maestro response
  Object.keys(filesByAnalysisId).forEach((a: string) => {
    files = files.concat(filesByAnalysisId[a]);
  });

  const docsWithFile = files.map(async f => {
    // Confirm we have only a single donor
    if (f.donors.length > 1) {
      logger.warn(
        `File ${f.fileId} from analysis ${
          f.analysis.analysisId
        } has more than 1 donor: ${f.donors.map((donor: { donorId: string }) => donor.donorId)}`,
      );
    }
    if (!f.donors || f.donors.length < 1) {
      logger.error(`File ${f.fileId} has no associated donors`);
      throw new Error('FileCentricDocument has no donors, it cannot be converted to a File.');
    }

    const fileToCreate: File = {
      analysisId: f.analysis.analysisId,
      objectId: f.objectId,
      programId: f.studyId,
      repoId: dataCenterId,

      status: f.analysis.analysisState,

      donorId: f.donors[0].donorId,

      firstPublished: f.analysis.firstPublishedAt,
      embargoStage: EmbargoStage.PROGRAM_ONLY,
      releaseState: ReleaseState.RESTRICTED,

      labels: [],
    };

    const fileRecord = await fileService.getOrCreateFileRecordByObjId(fileToCreate);
    // here we can extract the file Id/labels for indexing later
    f.fileId = fileRecord.fileId as string;
    return f;
  });

  const docsToIndex = await Promise.all(docsWithFile);

  // call elasticsearch to index the batch of enriched file documents
  await indexer.index(docsToIndex);

  // for now return the docs
  return docsToIndex.map(d => {
    return d.object_id;
  });
}

export async function handleAnalysisSupressedOrUnpublished(analysisEvent: AnalysisUpdateEvent) {
  const analysis = analysisEvent.analysis;
  const dataCenterId = analysisEvent.songServerId;

  // get genomic files for an analysis
  const filesByAnalysisId = await convertAnalysisToFileDocuments([analysis], dataCenterId);
  let files: FileCentricDocument[] = [];

  // get the file docs arrays from maestro response
  Object.keys(filesByAnalysisId).forEach((a: string) => {
    files = files.concat(filesByAnalysisId[a]);
  });

  // remove from elastic index
  await indexer.remove(files);
}
