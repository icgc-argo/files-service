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
import * as vault from './external/vault';
import Logger from './logger';
const logger = Logger('Config');

let config: AppConfig | undefined = undefined;
export interface AppConfig {
  serverPort: string;
  openApiPath: string;
  kafkaProperties: {
    kafkaMessagingEnabled: boolean;
    kafkaBrokers: string[];
    kafkaClientId: string;
    consumers: {
      analysisUpdates: KafkaConsumerConfigurations;
      recalculateEmbargo: KafkaConsumerConfigurations;
    };
    producers: {
      publicRelease: KafkaProducerConfigurations;
    };
  };
  mongoProperties: MongoProps;
  elasticProperties: {
    node: string;
    username: string;
    password: string;
    indexName: string;
    createSampleIndex: boolean;
    repository?: string;
  };
  auth: {
    enabled: boolean;
    jwtKeyUrl: string;
    jwtKey: string;
    policy: string;
    writeScope: string;
    readScope: string;
  };
  analysisConverterUrl: string;
  analysisConverterTimeout: number;
  datacenter: {
    registryUrl: string;
    dataCenterId: string;
    url: string;
    fetchTimeout: number;
    batchSize: number;
    gatewayUrl: string;
  };
  rollcall: {
    url: string;
    aliasName: string;
    entity: string;
  };
  debug: {
    endpointsEnabled: boolean;
  };
}

export interface KafkaConsumerConfigurations {
  topic: string;
  group: string;
  dlq?: string;
}

export interface KafkaProducerConfigurations {
  topic: string;
}

export interface MongoProps {
  // Mongo
  dbUsername: string;
  dbPassword: string;
  writeConcern: string;
  writeAckTimeout: number;
  dbUrl: string; // allow overriding all the url
}

const loadVaultSecrets = async () => {
  const vaultEnabled = process.env.VAULT_ENABLED === 'true';
  let secrets: any = {};

  /** Vault */
  if (vaultEnabled) {
    if (process.env.VAULT_ENABLED && process.env.VAULT_ENABLED === 'true') {
      if (!process.env.VAULT_SECRETS_PATH) {
        logger.error('Path to secrets not specified but vault is enabled');
        throw new Error('Path to secrets not specified but vault is enabled');
      }
      try {
        secrets = await vault.loadSecret(process.env.VAULT_SECRETS_PATH);
      } catch (err) {
        logger.error('Failed to load secrets from vault.');
        throw new Error('Failed to load secrets from vault.');
      }
    }
  }
  return secrets;
};

const buildAppConfig = async (secrets: any): Promise<AppConfig> => {
  logger.debug('Building app config');
  const policy = process.env.EGO_POLICY || 'FILES-SVC';
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
      kafkaMessagingEnabled: process.env.KAFKA_MESSAGING_ENABLED !== 'false', // true unless set to 'false'
      kafkaClientId: process.env.KAFKA_CLIENT_ID || 'file-service',
      consumers: {
        analysisUpdates: {
          topic: process.env.KAFKA_ANALYSIS_UPDATES_TOPIC || 'song_analysis',
          group: process.env.KAFKA_ANLYSIS_UPDATES_GROUP || 'file-manager.group.analysis-updates',
          dlq: process.env.KAFKA_ANALYSIS_UPDATES_DLQ,
        },
        recalculateEmbargo: {
          topic: process.env.KAFKA_RECALCULATE_EMBARGO_TOPIC || 'file-manager.recalculate-embargo',
          group:
            process.env.KAFKA_RECALCULATE_EMBARGO_GROUP || 'file-manager.group.recalculate-embargo',
          // No need for DLQ. Failures will get corrected on next attempt if scheduled to run regularly.
        },
      },
      producers: {
        publicRelease: {
          topic: process.env.KAFKA_PUBLIC_RELEASE_TOPIC || 'files_public_release',
        },
      },
    },
    elasticProperties: {
      node: process.env.ES_NODE || 'http://localhost:9200',
      username: secrets.ES_USER || process.env.ES_USER,
      password: secrets.ES_PASSWORD || process.env.ES_PASSWORD,
      indexName: process.env.INDEX_NAME || 'file_centric_test',
      createSampleIndex: process.env.CREATE_SAMPLE_INDEX === 'true', // false unless set to 'true'
      repository: process.env.ES_SNAPSHOT_REPOSITORY,
    },
    auth: {
      enabled: process.env.AUTH_ENABLED !== 'false', // true unless set to 'false'
      jwtKeyUrl: process.env.JWT_KEY_URL || '',
      jwtKey: process.env.JWT_KEY || '',
      policy,
      writeScope: `${policy}.WRITE`,
      readScope: `${policy}.READ`,
    },
    analysisConverterUrl: process.env.ANALYSIS_CONVERTER_URL || '',
    analysisConverterTimeout: Number(process.env.ANALYSIS_CONVERTER_TIMEOUT || 30 * 1000),
    datacenter: {
      registryUrl: process.env.DC_REGISTRY_URL || '',
      dataCenterId: process.env.DC_ID || '',
      url: process.env.DC_URL || '',
      fetchTimeout: Number(process.env.DC_FETCH_TIMEOUT || 300 * 1000),
      batchSize: Number(process.env.DC_BATCH_SIZE || 50),
      gatewayUrl: process.env.DC_GATEWAY_URL || '',
    },
    rollcall: {
      url: process.env.ROLLCALL_URL || 'http://localhost:9001',
      aliasName: process.env.ROLLCALL_FILE_ALIAS || 'file_service_placeholder_alias',
      entity: process.env.ROLLCALL_FILE_ENTITY || 'fileserviceplaceholder',
    },
    debug: {
      endpointsEnabled: process.env.ENABLE_DEBUG_ENDPOINTS === 'true', // false unless set to 'true'
    },
  };
  return config;
};

export const getAppConfig = async (envFile?: string): Promise<AppConfig> => {
  if (config != undefined) {
    return config;
  }
  if (envFile) {
    dotenv.config({
      path: envFile,
    });
  } else {
    dotenv.config();
  }
  const secrets = await loadVaultSecrets();
  return buildAppConfig(secrets);
};

export const FILE_PAGE_SIZE_LIMIT =
  !Number(process.env.FILE_PAGE_SIZE_LIMIT) || Number(process.env.FILE_PAGE_SIZE_LIMIT) <= 0
    ? 20
    : Number(process.env.FILE_PAGE_SIZE_LIMIT);
