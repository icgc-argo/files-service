/*
 * Copyright (c) 2023 The Ontario Institute for Cancer Research. All rights reserved
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

/**
 * Note [Jon Eubank, 2021-04-09]:
 *   This is Maestro service, in everything but name.
 *
 *   Maestro is the Overture application that is used to convert a Song Analyis into
 *   FileCentric index documents. In the code, we are referring to this service as
 *                                 * analysisConverter *
 *   Naming it generically suggests that a different service could be swapped in to
 *   perform this transformation. Also, the name analysisConverter is more clear in purpose
 *   than something named 'Maestro'. There are no plans to do this but its simple enough
 *   a service that we kept the code references as the generic 'analysisConverter' instead of 'maestro'.
 *
 *   So, for current purposes, analysisConverter = Maestro.
 *
 *   https://github.com/overture-stack/maestro
 *
 */

import PromisePool from '@supercharge/promise-pool';
import fetch from 'node-fetch';

import { SongAnalysis } from './song';
import { getAlignmentMetrics } from './dataCenterGateway';

import { getAppConfig } from '../config';
import Logger from '../logger';
const logger = Logger('AnalysisConverter');

const CONVERTER_CONCURRENT_REQUESTS = 5;

const addMetricsToAlignedReadsFile = async (
  fileDocument: RdpcFileDocument,
  objectId: string,
): Promise<RdpcFileDocument> => {
  const runId = fileDocument.analysis.workflow?.run_id;
  if (runId) {
    const metrics = await getAlignmentMetrics(runId);

    const fileWithMetrics = { ...fileDocument, metrics };
    return fileWithMetrics;
  } else {
    return fileDocument;
  }
};

export type RdpcFileDocument = { [k: string]: any } & {
  objectId: string;
  studyId: string;
  dataType?: string;
  repositories: { [k: string]: string }[];
  analysis: { [k: string]: any; analysisState: string };
};

/**
 *
 * @param analyses
 * @param repoCode
 * @returns
 */
export async function convertAnalysesToFileDocuments(
  analyses: SongAnalysis[],
  repoCode: string,
): Promise<RdpcFileDocument[]> {
  const output: RdpcFileDocument[] = [];

  // Can't send hundreds of analyses in a single request, so this is simplified to 1 at a time to gaurantee success.
  await PromisePool.withConcurrency(CONVERTER_CONCURRENT_REQUESTS)
    .for(analyses)
    .process(async analysis => {
      const files = await fetchAnalysisToFileConversion(analysis, repoCode);
      output.push(...files);
    });
  return output;
}

async function fetchAnalysisToFileConversion(analysis: SongAnalysis, repoCode: string): Promise<RdpcFileDocument[]> {
  const config = await getAppConfig();
  const url = config.analysisConverterUrl;
  const timeout = config.analysisConverterTimeout;

  const result = await fetch(url, {
    body: JSON.stringify({ analyses: [analysis], repoCode }),
    method: 'POST',
    timeout: timeout,
    headers: { 'Content-Type': 'application/json' },
  });
  if (result.status != 201) {
    logger.error(`Error response from converter: ${await result.text()}`);
    throw new Error(`Failed to convert analysis ${analysis.analysisId} to files, got response ${result.status}`);
  }

  const response: {
    [k: string]: RdpcFileDocument[];
  } = await result.json();
  // Convert the Analysis response (Map of FileCentricDocuments)
  const files: RdpcFileDocument[] = [];

  // get the file docs arrays from maestro response
  await PromisePool.withConcurrency(CONVERTER_CONCURRENT_REQUESTS)
    .for(Object.keys(response))
    .process(async (objectId: string) => {
      const responseFile = response[objectId][0];
      if (
        responseFile?.dataType === 'Aligned Reads' &&
        responseFile.analysis.analysisState === 'PUBLISHED' &&
        responseFile.analysis.workflow?.workflow_name === 'DNA Seq Alignment'
      ) {
        const fileWithMetrics = await addMetricsToAlignedReadsFile(responseFile, objectId);
        files.push(fileWithMetrics);
      } else {
        files.push(...response[objectId]);
      }
    });

  return files;
}
