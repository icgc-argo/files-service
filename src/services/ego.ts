/*
 * Copyright (c) 2022 The Ontario Institute for Cancer Research. All rights reserved
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

import egoTokenUtils from '@icgc-argo/ego-token-utils';
import fetch from 'node-fetch';
import urlJoin from 'url-join';
import { getAppConfig } from '../config';
import Logger from '../logger';

const logger = Logger('Ego');

export type EgoApplicationCredential = {
  clientId: string;
  clientSecret: string;
};

export type AuthClient = {
  getAuth: () => Promise<string>;
};

type EgoAccessToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  groups: string;
};

type EgoAccessTokenError = {
  error: string;
  error_description: string;
};

const getEgoPublicKey = async (): Promise<string> => {
  const config = await getAppConfig();

  if (config.auth.jwtKey) {
    return config.auth.jwtKey;
  }

  if (config.auth.jwtKeyUrl) {
    const response = await fetch(config.auth.jwtKeyUrl);

    if (!response.ok) {
      throw new Error(
        `Ego public key fetch failed with non-200 response: ${response.status} ${response.statusText}`,
      );
    }

    return await response.text();
  }

  return '';
};

const getApplicationJwt = async (
  applicationCredentials: EgoApplicationCredential,
): Promise<string> => {
  const config = await getAppConfig();

  const url = urlJoin(
    config.auth.egoRootRest,
    `/oauth/token?client_id=${applicationCredentials.clientId}&client_secret=${applicationCredentials.clientSecret}&grant_type=client_credentials`,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Auth request failed with non-200 response: ${response.status} ${response.statusText}`,
    );
  }

  const authResponse = await response.json();

  if (authResponse.error) {
    throw new Error(
      `Failed to authorize application: ${(authResponse as EgoAccessTokenError).error_description}`,
    );
  }

  return (authResponse as EgoAccessToken).access_token;
};

export const createAuthClient = async () => {
  let latestJwt: string;

  const config = await getAppConfig();

  const appCredentials = {
    clientId: config.auth.egoClientId,
    clientSecret: config.auth.egoClientSecret,
  } as EgoApplicationCredential;

  const getAuth = async () => {
    if (latestJwt && egoTokenUtils(await getEgoPublicKey()).isValidJwt(latestJwt)) {
      return latestJwt;
    }
    logger.debug(`JWT is no longer valid, fetching new token from ego...`);
    return await getApplicationJwt(appCredentials);
  };

  return {
    getAuth,
  };
};
