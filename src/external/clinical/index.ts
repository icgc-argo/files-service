// /*
//  * Copyright (c) 2023 The Ontario Institute for Cancer Research. All rights reserved
//  *
//  * This program and the accompanying materials are made available under the terms of
//  * the GNU Affero General Public License v3.0. You should have received a copy of the
//  * GNU Affero General Public License along with this program.
//  *  If not, see <http://www.gnu.org/licenses/>.
//  *
//  * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
//  * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//  * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
//  * SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
//  * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
//  * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
//  * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
//  * ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//  */

import fetch from 'node-fetch';
import urljoin from 'url-join';

import { getAppConfig } from '../../config';

import _ from 'lodash';
import { getEgoToken } from '../../external/ego';
import Logger from '../../logger';
import { ClinicalDonor } from './types';
import AsyncCache from '../../utils/asyncCache';
const logger = Logger('Clinical');

// Cache results of fetching donor data from clinical service. Keep cached results for 5 minutes.
const DONOR_FETCH_CACHE = AsyncCache(
  (inputs: { programId: string; donorId: string }) => fetchDonor(inputs.programId, inputs.donorId),
  { expiryTime: 5 * 60 * 1000 },
);

/**
 * Retrieve donor information from clinical service with cached results to prevent redundant fetching
 * @param programId
 * @param donorId
 * @returns
 */
export async function getDonor(programId: string, donorId: string): Promise<ClinicalDonor | undefined> {
  return DONOR_FETCH_CACHE.get({ programId, donorId });
}

/**
 * Fetch clinical data for a single donor, identified by programId and donorId
 * @param programId
 * @param donorId
 * @returns
 */
async function fetchDonor(programId: string, donorId: string): Promise<ClinicalDonor | undefined> {
  const config = await getAppConfig();
  try {
    logger.debug(`fetchDonor()`, `Fetcing clinical data for ${JSON.stringify({ programId, donorId })}`);
    const requestUrl = urljoin(config.clinical.url, 'clinical/program', programId, 'donor', donorId);
    const response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${await getEgoToken()}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP Error Response: ${response.status} ${errorBody}`);
    }

    const rawDonor = await response.json();
    const parsedDonor = ClinicalDonor.safeParse(rawDonor);
    if (parsedDonor.success) {
      return parsedDonor.data;
    } else {
      logger.error(`fetchDonor()`, `Error validating result from fetched donor`, parsedDonor.error);
      return undefined;
    }
  } catch (e) {
    logger.warn(`fetchDonor()`, `Error fetching clinical data for ${JSON.stringify({ programId, donorId })}`, <Error>e);
    return undefined;
  }
}

export async function* fetchAllDonorsForProgram(programId: string): AsyncGenerator<ClinicalDonor> {
  const config = await getAppConfig();

  logger.debug(`fetchAllDonorsForProgram()`, `Begining fetch of all donors for program: ${programId}`);

  const logFrequency = 100;

  const requestUrl = urljoin(config.clinical.url, 'clinical/program', programId, 'donors');
  const response = await fetch(requestUrl, {
    headers: {
      Authorization: `Bearer ${await getEgoToken()}`,
    },
  });
  // Expected response is json-lines: new line delimited JSON documents that will be streamed in chunks
  // The next section turns the body response stream into an async iterator
  let donorCount = 0;
  let unprocessedResponse = '';
  for await (const chunk of response.body) {
    let leftovers = '';
    unprocessedResponse += chunk;
    const splitResponse = unprocessedResponse.split('\n');
    const donors = splitResponse
      .filter(chunk => {
        // occasionally in testing an empty item was found in the split response so lets filter those out.
        return !_.isEmpty(chunk);
      })
      .map(chunk => {
        try {
          return JSON.parse(chunk);
        } catch (err) {
          if (err instanceof SyntaxError) {
            // In practice, the response stream can include partial messages, likely because the packet size is smaller than the donors
            // So we will capture the partial response and combine it with the next message.
            leftovers += chunk;
            return undefined;
          } else {
            // Should not see this, only Syntax Errors from JSON parsing incomplete objects. Adding this just to capture any strange results.
            logger.error(
              `fetchAllDonorsForProgram()`,
              `Unexpected error parsing data returned by Clinical API. ${err}`,
            );
            throw err;
          }
        }
      })
      .filter(content => content !== undefined);
    for (const donor of donors) {
      yield donor;
      donorCount++;
      if (donorCount % logFrequency === 0) {
        logger.debug(`Received clinical data for ${donorCount} donors for program: ${programId}`);
      }
    }
    unprocessedResponse = leftovers;
  }

  logger.debug(`fetchAllDonorsForProgram()`, `Retrieved ${donorCount} donors for program: ${programId}`);
  if (!_.isEmpty(unprocessedResponse)) {
    logger.warn(`fetchAllDonorsForProgram()`, `Part of the API message was unprocessed! - ${unprocessedResponse}`);
  }
  return;
}
