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

import { Client } from '@elastic/elasticsearch';

import { getAppConfig } from '../config';
import esMapping from '../resources/file-centric-index-mapping.json';
import Logger from '../logger';
const logger = Logger('Elasticsearch');

let esClient: Client;

export async function getClient() {
  if (esClient) {
    return esClient;
  }
  const config = await getAppConfig();
  esClient = new Client({
    node: config.elasticProperties.node,
    auth: {
      username: config.elasticProperties.username,
      password: config.elasticProperties.password,
    },
  });
  await esClient.ping();
  return esClient;
}

export async function createSnapshot(content: {
  indices: string[];
  label: string;
}): Promise<string | void> {
  const {
    elasticProperties: { repository },
  } = await getAppConfig();

  if (repository) {
    const snapshot = `release_${content.label}_${Date.now()}`;
    logger.info(`Creating snapshot ${snapshot} for indices: ${content.indices}`);
    await esClient.snapshot.create({
      repository,
      snapshot,
      wait_for_completion: true,
      body: {
        indices: content.indices.join(','),
        ignore_unavailable: true,
        include_global_state: false,
        metadata: {},
      },
    });
    logger.info(`Snapshot ${snapshot} created successfully.`);
    return snapshot;
  }
  return;
}

const checkIndexExists = async (index: string, esClient: Client) => {
  try {
    await esClient.indices.get({
      index: index,
    });
    logger.info(`index ${index} exists`);
  } catch (e) {
    if ((<Error>e).name === 'ResponseError' && (<Error>e).message === 'index_not_found_exception') {
      logger.error(`Index ${index} doesn't exist.`);
      throw e;
    } else {
      logger.error(`Failed to check index ${index}`, e);
      throw e;
    }
  }
};

const createSampleIndex = async (index: string, esClient: Client) => {
  try {
    await esClient.indices.create({
      index: index,
      body: esMapping,
    });
    logger.info(`index ${index} exists`);
  } catch (e) {
    if (
      (<Error>e).name === 'ResponseError' &&
      (<Error>e).message === 'resource_already_exists_exception'
    ) {
      logger.info(`Index ${index} already exist.`);
    } else {
      logger.error(`Failed to check index ${index} ${e}`);
      throw e;
    }
  }
};
