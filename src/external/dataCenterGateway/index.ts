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

import { get } from 'lodash';
import { GraphQLClient } from 'graphql-request';
import { getAppConfig } from '../../config';
import ALIGNMENT_METRICS_BY_RUN_ID from './gql/QUERY_ALIGNMENT_METRICS_BY_RUN_ID';
import SAMPLE_MATCHED_ANALYSIS_BY_DONOR from './gql/QUERY_SAMPLE_MATCHED_ANALYSIS_BY_DONOR_ID';
import { getEgoToken } from '../../external/ego';

import Logger from '../../logger';
const logger = Logger('DataCenterGateway');

export const getAlignmentMetrics = async (runId: string) => {
  const config = await getAppConfig();
  const url = config.datacenter.gatewayUrl;
  const graphQLClient = new GraphQLClient(url, {
    headers: {
      authorization: `Bearer ${await getEgoToken()}`,
    },
  });
  const query = ALIGNMENT_METRICS_BY_RUN_ID;
  const variables = { runId };

  const data = await graphQLClient.request(query, variables).catch((err: Error) => {
    logger.error(`Error fetching alignment metrics for run ${runId}: ${err}`);
    throw err;
  });

  const metrics = get(data, 'analyses.content[0].files[0].metrics', undefined);
  return metrics;
};

export type MatchedSamplePair = {
  normalSampleAnalysis: { firstPublishedAt: string };
  tumourSampleAnalysis: { firstPublishedAt: string };
};
export const getMatchedPairsForDonor = async (donorId: String): Promise<MatchedSamplePair[]> => {
  const config = await getAppConfig();
  const url = config.datacenter.gatewayUrl;
  const graphQLClient = new GraphQLClient(url, {
    headers: {
      authorization: `Bearer ${await getEgoToken()}`,
    },
  });
  const query = SAMPLE_MATCHED_ANALYSIS_BY_DONOR;
  const variables = { donorId };

  const data = await graphQLClient.request(query, variables).catch((err: Error) => {
    logger.error(`Error fetching matched sample pairs for donor ${donorId}: ${err}`);
    throw err;
  });

  // Any type will be converted by method signature to the MatchedSamplePair structure declared in the gql query
  return data.sampleMatchedAnalysesForDonor;
};
