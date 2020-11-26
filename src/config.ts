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

import * as dotenv from 'dotenv';
import * as vault from './vault';

let config: AppConfig | undefined = undefined;
export interface AppConfig {
  // Express
  serverPort: string;
  openApiPath: string;
  kafkaProperties: KafkaConfigurations;
  mongoProperties: MongoProps;
  elasticProperties: {
    node: string;
    username: string;
    password: string;
    indexName: string;
    createSampleIndex: string;
  };
  auth: {
    enabled: boolean;
    jwtKeyUrl: string;
    jwtKey: string;
    writeScope: string;
  };
  analysisConverterUrl: string;
}

export interface MongoProps {
  // Mongo
  dbUsername: string;
  dbPassword: string;
  writeConcern: string;
  writeAckTimeout: number;
  dbUrl: string; // allow overriding all the url
}
export interface KafkaConfigurations {
  kafkaMessagingEnabled: boolean;
  kafkaClientId: string;
  kafkaBrokers: string[];
}

const loadVaultSecrets = async () => {
  const vaultEnabled = process.env.VAULT_ENABLED || false;
  let secrets: any = {};
  /** Vault */
  if (vaultEnabled) {
    if (process.env.VAULT_ENABLED && process.env.VAULT_ENABLED == 'true') {
      if (!process.env.VAULT_SECRETS_PATH) {
        throw new Error('Path to secrets not specified but vault is enabled');
      }
      try {
        secrets = await vault.loadSecret(process.env.VAULT_SECRETS_PATH);
      } catch (err) {
        console.error(err);
        throw new Error('failed to load secrets from vault.');
      }
    }
  }
  return secrets;
};

const buildAppConfig = async (secrets: any): Promise<AppConfig> => {
  console.log('building app context');
  config = {
    serverPort: process.env.PORT || '3000',
    openApiPath: process.env.OPENAPI_PATH || '/api-docs',
    mongoProperties: {
      dbUsername: secrets.DB_USERNAME || process.env.DB_USERNAME,
      dbPassword: secrets.DB_PASSWORD || process.env.DB_PASSWORD,
      dbUrl: secrets.DB_URL || process.env.DB_URL || `mongodb://localhost:27027/appdb`,
      writeConcern: process.env.DEFAULT_WRITE_CONCERN || 'majority',
      writeAckTimeout: Number(process.env.DEFAULT_WRITE_ACK_TIMEOUT) || 5000,
    },
    kafkaProperties: {
      kafkaBrokers: process.env.KAFKA_BROKERS?.split(',') || new Array<string>(),
      kafkaClientId: process.env.KAFKA_CLIENT_ID || '',
      kafkaMessagingEnabled: process.env.KAFKA_MESSAGING_ENABLED === 'true' ? true : false,
    },
    elasticProperties: {
      node: process.env.ES_NODE || 'http://localhost:9200',
      username: secrets.ES_USER || process.env.ES_USER,
      password: secrets.ES_PASSWORD || process.env.ES_PASSWORD,
      indexName: process.env.INDEX_NAME || 'file_centric_test',
      createSampleIndex: process.env.CREATE_SAMPLE_INDEX || 'false',
    },
    auth: {
      enabled: process.env.AUTH_ENABLED !== 'false',
      jwtKeyUrl: process.env.JWT_KEY_URL || '',
      jwtKey: process.env.JWT_KEY || '',
      writeScope: process.env.WRITE_SCOPE || 'FILES-SVC.WRITE',
    },
    analysisConverterUrl: process.env.ANALYSIS_CONVERTER_URL || '',
  };
  return config;
};

export const getAppConfig = async (): Promise<AppConfig> => {
  if (config != undefined) {
    return config;
  }
  dotenv.config();
  const secrets = await loadVaultSecrets();
  return buildAppConfig(secrets);
};
