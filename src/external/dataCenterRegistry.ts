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

import { getAppConfig } from '../config';

export interface DataCenter {
  centerId: string;
  country: string;
  name: string;
  organization: string;
  contactEmail: string;
  storageType: string;
  url: string;
  type: string;
}

export const getDataCenter = async (dataCenterId: string): Promise<DataCenter> => {
  const url = (await getAppConfig()).datacenter.url;

  const placeholderDatacenter = {
    centerId: 'collab',
    country: 'CA',
    name: 'Cancer Collaboratory Cloud2',
    organization: 'Acme',
    contactEmail: 'joe.smith@example.com',
    storageType: 'S3',
    type: 'RDPC',

    // URL from config:
    url,
  };
  return placeholderDatacenter;
};

export const getAllDataCenters = async (): Promise<DataCenter[]> => {
  const url = (await getAppConfig()).datacenter.url;
  const placeholderDatacenter = {
    centerId: 'collab',
    country: 'CA',
    name: 'Cancer Collaboratory Cloud2',
    organization: 'Acme',
    contactEmail: 'joe.smith@example.com',
    storageType: 'S3',
    type: 'RDPC',

    // URL from config:
    url,
  };
  return [placeholderDatacenter];
};
