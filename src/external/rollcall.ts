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
import { AppConfig } from '../config';

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
  release: (indexName: Index) => Promise<boolean>;
};

const RELEASE = {
  PUBLIC: 'public',
  RESTRICTED: 'restricted',
};

export default (config: AppConfig): RollCallClient => {
  const rootUrl = config.rollcall.url;
  const aliasName = config.rollcall.aliasName;
  const indexEntity = config.rollcall.entity;
  const indexType = 'centric';
  const shardPrefix = 'program';

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
    const url = urljoin(`${rootUrl}`, `/indices/create`);

    const req: CreateResolvableIndexRequest = {
      shardPrefix: shardPrefix,
      shard: await formatProgramShortName(programShortName),
      entity: indexEntity,
      type: indexType,
      cloneFromReleasedIndex: cloneFromReleasedIndex || false,
      releasePrefix: isPublic ? RELEASE.PUBLIC : RELEASE.RESTRICTED,
    };

    try {
      const newResolvedIndex = (await fetch(url, {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'Content-Type': 'application/json' },
      }).then(res => res.json())) as Index;

      return newResolvedIndex;
    } catch (err) {
      logger.error('Failed to get new index from rollcall: ' + err);
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

  const convertResolvedIndexToIndexReleaseRequest = async (
    resovledIndex: Index,
  ): Promise<IndexReleaseRequest> => {
    const alias = aliasName;
    const shard = resovledIndex.shardPrefix + '_' + resovledIndex.shard;
    const release = resovledIndex.releasePrefix + '_' + resovledIndex.release;

    return { alias, release, shards: [shard] };
  };

  const formatProgramShortName = async (programShortName: string) => {
    return programShortName
      .replace('-', '')
      .trim()
      .toLowerCase();
  };

  return {
    fetchNextIndex,
    release,
  };
};
