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

import logger from '../logger';
// import { FilePartialDocument } from '../external/analysisConverter';
import { getClient } from '../external/elasticsearch';
import { getAppConfig } from '../config';
import { FileCentricDocument } from './fileCentricDocument';

const getIndexName = async () => {
  return (await getAppConfig()).elasticProperties.indexName;
};

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
      index: await getIndexName(),
      body,
    });
  } catch (e) {
    logger.error(`failed bulk indexing request: ${JSON.stringify(e)}`, e);
    throw e;
  }
}

export async function remove(docs: { [k: string]: any; objectId: string }[]) {
  const client = await getClient();
  const body = docs.map(doc => ({ delete: { _id: doc.objectId } }));

  try {
    await client.bulk({
      index: await getIndexName(),
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
