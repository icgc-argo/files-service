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

import fetch from 'node-fetch';
import urljoin from 'url-join';

import logger from '../logger';
import { getAppConfig } from '../config';
import { getClient } from './elasticsearch';
import fileCentricConfig from '../file-centric-index-mapping.json';

// Rollcall builds the index name as `entity_type_shardPrefix_shard_releasePrefix_release`,
// release is not in the request because rollcall will calculate it
export type CreateResolvableIndexRequest = {
  entity: string;
  shard: string;
  shardPrefix: string;
  type: string;
  releasePrefix?: string;
  indexSetting?: string;
  cloneFromReleasedIndex?: boolean; // used to clone previously released index with similar parameters
};

export type IndexReleaseRequest = {
  alias: string;
  release: string;
  shards: string[];
};

export type Index = {
  indexName: string;
  entity: string;
  type: string;
  shardPrefix: string;
  shard: string;
  releasePrefix: string;
  release: string;
  valid: boolean;
};

export type RollCallClient = {
  fetchNextIndex: (
    programShortName: string,
    options: { isPublic: boolean; cloneFromReleasedIndex: boolean },
  ) => Promise<Index>;
  fetchCurrentIndex: (programShortName: string, isPublic: boolean) => Promise<Index | undefined>;
  release: (indexName: Index) => Promise<boolean>;
};

const RELEASE_STATE = {
  PUBLIC: 'public',
  RESTRICTED: 'restricted',
};

export default async (): Promise<RollCallClient> => {
  const config = await getAppConfig();

  const rootUrl = config.rollcall.url;
  const aliasName = config.rollcall.aliasName;
  const indexEntity = config.rollcall.entity;
  const indexType = 'centric';
  const shardPrefix = (isPublic: boolean) =>
    isPublic ? RELEASE_STATE.PUBLIC : RELEASE_STATE.RESTRICTED;
  const releasePrefix = 're';

  const client = await getClient();

  const fetchCurrentIndex = async (
    programShortName: string,
    isPublic: boolean,
  ): Promise<Index | undefined> => {
    logger.debug(`Fetching current index ${programShortName} isPublic:${isPublic}`);
    const url = urljoin(rootUrl, `/indices/resolved`);

    const shard = formatProgramShortName(programShortName);

    const response = (await fetch(url).then(res => res.json())) as Index[];

    const latestIndex = response
      .filter(index => index.shard === shard && index.shardPrefix === shardPrefix(isPublic))
      .sort((a, b) => (a.release > b.release ? 1 : -1))
      .pop();

    return latestIndex;
  };

  const fetchNextIndex = async (
    programShortName: string,
    {
      isPublic = false,
      cloneFromReleasedIndex = false,
    }: { isPublic: boolean; cloneFromReleasedIndex: boolean },
  ): Promise<Index> => {
    logger.info(
      `Fetching from Rollcall next index for ${programShortName}. Public=${isPublic}. Cloned=${cloneFromReleasedIndex}.`,
    );
    const url = urljoin(rootUrl, `/indices/create`);

    const req: CreateResolvableIndexRequest = {
      shardPrefix: shardPrefix(isPublic),
      shard: formatProgramShortName(programShortName),
      entity: indexEntity,
      type: indexType,
      cloneFromReleasedIndex: cloneFromReleasedIndex || false,
      releasePrefix,
    };
    try {
      const newIndex = (await fetch(url, {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'Content-Type': 'application/json' },
      }).then(res => res.json())) as Index;

      // Set the mapping and update settings
      await configureIndex(newIndex);

      logger.info(`[Rollcall] New index: ${newIndex.indexName}`);
      return newIndex;
    } catch (err) {
      logger.error('[Rollcall] Failed to get new index from rollcall: ' + err);
      throw err;
    }
  };

  const release = async (resovledIndex: Index): Promise<boolean> => {
    logger.info(
      `Requesting Rollcall to release index ${resovledIndex.indexName} to alias ${aliasName}`,
    );
    const url = urljoin(`${rootUrl}`, `/aliases/release`);

    const req = await convertResolvedIndexToIndexReleaseRequest(resovledIndex);

    const acknowledged = (await fetch(url, {
      method: 'POST',
      body: JSON.stringify(req),
      headers: { 'Content-Type': 'application/json' },
    }).then(res => res.json())) as boolean;

    return acknowledged;
  };

  const configureIndex = async (index: Index): Promise<void> => {
    try {
      await client.indices.close({ index: index.indexName });

      await client.indices.putSettings({
        index: index.indexName,
        body: { ...fileCentricConfig.settings, 'index.blocks.write': false },
      });
      await client.indices.putMapping({
        index: index.indexName,
        body: fileCentricConfig.mappings,
      });
      await client.indices.open({ index: index.indexName });
    } catch (e) {
      console.error(JSON.stringify(e));
    }
  };

  const convertResolvedIndexToIndexReleaseRequest = async (
    resovledIndex: Index,
  ): Promise<IndexReleaseRequest> => {
    const alias = aliasName;
    const shard = resovledIndex.shardPrefix + '_' + resovledIndex.shard;
    const release = resovledIndex.releasePrefix + '_' + resovledIndex.release;

    return { alias, release, shards: [shard] };
  };

  const formatProgramShortName = (programShortName: string) => {
    return programShortName
      .replace('-', '')
      .trim()
      .toLowerCase();
  };

  return {
    fetchNextIndex,
    fetchCurrentIndex,
    release,
  };
};
