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
 * TODO: Fetch all data from the DCR service.
 *       This service is a placeholder while refactoring. Currently it returns placeholder
 *       datacenter information with a URL from the config and all other data from the
 *       DCR example response.
 */

import { isArray, isObjectLike, isString } from 'lodash';
import urljoin from 'url-join';
import { getAppConfig } from '../config';
import Logger from '../logger';
const logger = Logger('DataCenterRegistry');

export interface DataCenter {
  centerId: string;
  songUrl: string;
}

function isDataCenter(input: any): input is DataCenter {
  return isObjectLike(input) && isString(input.centerId) && isString(input.songUrl);
}

const getPlaceholder = async () => ({
  centerId: 'collab',
  songUrl: (await getAppConfig()).datacenter.url,
});

/**
 * Retrieves connection details for a data center by ID
 * @param dataCenterId
 * @returns
 */
export const getDataCenter = async (dataCenterId: string): Promise<DataCenter> => {
  const config = await getAppConfig();
  try {
    const requestUrl = urljoin(config.datacenter.registryUrl, 'data-centers', dataCenterId);

    const response = await fetch(requestUrl);
    const data = await response.json();

    if (isDataCenter(data)) {
      return data;
    }

    throw new Error(
      `Response object returned for Data Center is badly formed or missing a required field. Response data: ${data}`,
    );
  } catch (e) {
    logger.error(`Failed to fetch Data Centers ${dataCenterId}: ${e}`);
    throw e;
  }
};

/**
 * Retrieves connection details for all data centers
 * Note: This will filter out any objects in the response array that are missing required properties for the DataCenter type
 */
export const getAllDataCenters = async (): Promise<DataCenter[]> => {
  const config = await getAppConfig();

  try {
    const requestUrl = urljoin(config.datacenter.registryUrl, 'data-centers');

    const response = await fetch(requestUrl);
    const data = await response.json();

    if (isArray(data)) {
      return data.filter(isDataCenter) as DataCenter[];
    }
    throw new Error(`Response object returned for Data Centers is badly formed (Not an array). Response data: ${data}`);
  } catch (e) {
    logger.error(`Failed to fetch all Data Centers: ${e}`);
    throw e;
  }
};
