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
  fileDocument: { [k: string]: RdpcFileDocument[] },
  objectId: string,
): Promise<RdpcFileDocument[]> => {
  const runId = fileDocument[objectId][0].analysis.workflow.run_id;
  const metrics = await getAlignmentMetrics(runId);

  const fileWithMetrics = [{ ...fileDocument[objectId][0], metrics }];
  return fileWithMetrics;
};

export type RdpcFileDocument = { [k: string]: any } & {
  objectId: string;
  studyId: string;
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
      const files = await convertAnalysisFileDocuments(analysis, repoCode);
      output.push(...files);
    });
  return output;
}

export async function convertAnalysisFileDocuments(
  analysis: SongAnalysis,
  repoCode: string,
): Promise<RdpcFileDocument[]> {
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
    throw new Error(
      `Failed to convert analysis ${analysis.analysisId} to files, got response ${result.status}`,
    );
  }

  const response: {
    [k: string]: RdpcFileDocument[];
  } = await result.json();
  // Convert the Analysis response (StringMap of FileCentricDocuments)
  const files: RdpcFileDocument[] = [];

  // get the file docs arrays from maestro response
  await PromisePool.withConcurrency(CONVERTER_CONCURRENT_REQUESTS)
    .for(Object.keys(response))
    .process(async (objectId: string) => {
      if (
        response[objectId][0].dataType === 'Aligned Reads' &&
        response[objectId][0].analysis.analysisState === 'PUBLISHED' &&
        response[objectId][0].analysis.workflow.workflow_name === 'DNA Seq Alignment'
      ) {
        const fileWithMetrics = await addMetricsToAlignedReadsFile(response, objectId);
        files.push(...fileWithMetrics);
      } else {
        files.push(...response[objectId]);
      }
    });

  return files;
}
