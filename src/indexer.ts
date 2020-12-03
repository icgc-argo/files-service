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

import { getAppConfig } from './config';
import { FileCentricDocument } from './entity';
import { Client } from '@elastic/elasticsearch';
import esMapping from './resources/file_centric_example.json';
import logger from './logger';

let esClient: Client;
let indexName: string = '';

async function getClient() {
  if (esClient) return esClient;
  const config = await getAppConfig();
  esClient = new Client({
    node: config.elasticProperties.node,
    auth: {
      username: config.elasticProperties.username,
      password: config.elasticProperties.password,
    },
  });
  await esClient.ping();
  indexName = config.elasticProperties.indexName;
  if (config.elasticProperties.createSampleIndex.toLowerCase() == 'true') {
    await createSampleIndex(indexName, esClient);
  } else {
    await checkIndexExists(indexName, esClient);
  }
  return esClient;
}

export async function index(docs: FileCentricDocument[]) {
  const client = await getClient();
  const body = docs.map(camelCaseKeysToUnderscore).flatMap(doc => [
    { update: { _id: doc.object_id } },
    {
      doc_as_upsert: true,
      doc,
    },
  ]);

  try {
    await client.bulk({
      index: indexName,
      body,
    });
  } catch (e) {
    logger.error(`failed bulk indexing request: ${JSON.stringify(e)}`, e);
    throw e;
  }
}

export async function remove(docs: FileCentricDocument[]) {
  const client = await getClient();
  const body = docs.map(doc => ({ delete: { _id: doc.object_id } }));

  try {
    await client.bulk({
      index: indexName,
      body,
    });
  } catch (e) {
    logger.error(`failed bulk delete request: ${JSON.stringify(e)}`, e);
    throw e;
  }
}

function camelCaseKeysToUnderscore(obj: any) {
  if (typeof obj != 'object') return obj;

  for (const oldName in obj) {
    // Camel to underscore
    const newName = oldName.replace(/([A-Z])/g, function($1) {
      return '_' + $1.toLowerCase();
    });

    // Only process if names are different
    if (newName != oldName) {
      // Check for the old property name to avoid a ReferenceError in strict mode.
      if (obj.hasOwnProperty(oldName)) {
        obj[newName] = obj[oldName];
        delete obj[oldName];
      }
    }
    if (typeof obj[newName] == 'object') {
      obj[newName] = camelCaseKeysToUnderscore(obj[newName]);
    }
  }
  return obj;
}

const checkIndexExists = async (index: string, esClient: Client) => {
  try {
    await esClient.indices.get({
      index: index,
    });
    logger.info(`index ${index} exists`);
  } catch (e) {
    if (e.name == 'ResponseError' && e.message == 'index_not_found_exception') {
      logger.error(`index ${index} doesn't exist.`);
      throw e;
    } else {
      logger.error(`failed to check index ${index} ${e}`);
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
    if (e.name == 'ResponseError' && e.message == 'resource_already_exists_exception') {
      logger.info(`index ${index} already exist.`);
    } else {
      logger.error(`failed to check index ${index} ${e}`);
      throw e;
    }
  }
};
