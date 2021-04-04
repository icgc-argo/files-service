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

import { convertAnalysisToFileDocuments } from './analysisConverter';
import * as service from './service';
import * as indexer from './indexer';
import { AnalysisUpdateEvent, File, FileCentricDocument } from './entity';
import fetch from 'node-fetch';
import streamArray from 'stream-json/streamers/StreamArray';
import Batch from 'stream-json/utils/Batch';
import stream from 'stream';
import { getAppConfig } from './config';
import logger from './logger';
import abortController from 'abort-controller';

export async function processReindexRequest(dataCenterId: string) {
  try {
    logger.info(`indexing repo ${dataCenterId}`);
    const url = await getDataCenterUrl(dataCenterId);
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

async function getDataCenterUrl(dataCenterId: string) {
  const url = (await getAppConfig()).datacenter.url;
  return url;
}

async function generateStudyAnalyses(url: string, studyId: string) {
  const pipeline = await getAnalysesBatchesStream(url, studyId);
  // read one batch entry at a time
  return streamToAsyncGenerator<any>(pipeline, 1);
}

async function getStudies(url: string) {
  const res = await fetch(`${url}/studies/all`);
  const studies = await res.json();
  return studies;
}

async function getAnalysesBatchesStream(url: string, studyId: string) {
  const controller = new abortController();
  const timeoutPeriod = (await getAppConfig()).datacenter.fetchTimeout;
  const batchSize = (await getAppConfig()).datacenter.batchSize;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutPeriod);
  try {
    const res = await fetch(`${url}/studies/${studyId}/analysis?analysisStates=PUBLISHED`, {
      signal: controller.signal,
    });
    const resStream = res.body;
    const pipeline = resStream.pipe(streamArray.withParser()).pipe(new Batch({ batchSize }));
    return pipeline;
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

  const docsWithFile = files.map(async (f: FileCentricDocument) => {
    const fileToCreate: File = {
      analysisId: f.analysis.analysisId,
      objectId: f.objectId,
      programId: f.studyId,
      repoId: dataCenterId,
      labels: [],
    };

    const fileRecord = await service.getOrCreateFileRecordByObjId(fileToCreate);
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

// source: https://www.derpturkey.com/nodejs-async-generators-for-streaming/
// Converts a stream into an AsyncGenerator that allows reading bytes
// of data from the stream in the chunk size specified. This function
// has some similarities to the `;streamToGenerator` function.
function streamToAsyncGenerator<T>(
  reader: stream.Readable,
  chunkSize?: number,
): AsyncGenerator<T, void, unknown> {
  // Immediately invoke the AsyncGenerator function which will closure
  // scope the stream and returns the AsyncGenerator instance
  return (async function* genFn() {
    // Construct a promise that will resolve when the Stream has
    // ended. We use it below as a conditional resolution of the
    // readable and end events.
    const endPromise = signalEnd(reader);

    while (true) {
      console.log('reading..');
      // Next, similar to readToEnd function, we loop on the
      // Stream until we have read all of the data that we
      // can from the stream.
      while (reader.readable) {
        console.log('readable');
        // First try to read the chunk size, but if that fails
        // then try reading the remainder of the stream.
        const val = reader.read(chunkSize) || reader.read();

        // Either yield the contents to our generator or there
        // was no data and we are no longer readable and need
        // to wait for more info
        if (val) yield val;
        else break;
      }

      // We are no longer readable and one of two things will
      // happen now: `;readable` or `;end` will fire. We construct
      // a new `;readable` signal to wait for the next signal.
      const readablePromise = signalReadable(reader);

      // We wait for either the `;end` or `;readable` event to fire
      const result = await Promise.race([endPromise, readablePromise]);
      if (result == 'done') {
        console.log('race done');
        return;
      }
    }
  })();
}

// Resolves when the stream fires its next `;readable` event. We use the
// event `;once` method so that it only ever fires on the next `;readable`
// event
async function signalReadable(reader: stream.Readable) {
  return new Promise<string>(resolve => {
    reader.once('readable', () => resolve('not yet'));
  });
}

// Resolves when the stream fires the `;end` event. We use the `;once`
// method so that the promise only resolves once.
async function signalEnd(reader: stream.Readable) {
  return new Promise<string>(resolve => {
    reader.once('end', () => resolve('done'));
  });
}
