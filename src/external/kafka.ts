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

import { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs';
import { AppConfig } from '../config';
import retry from 'async-retry';
import analysisEventProcessor from '../services/processAnalysisEvent';
import Logger from '../logger';
const logger = Logger('Kafka');
import { PublicReleaseMessage } from 'kafkaMessages';

export type AnalysisUpdateEvent = {
  songServerId: string;
  analysis: { [k: string]: any };
};

let analysisUpdatesConsumer: Consumer | undefined;
let analysisUpdatesDlqProducer: Producer | undefined;
let publicReleaseProducer: Producer;
let publicReleaseTopic: string;

export const setup = async (config: AppConfig) => {
  const kafka = new Kafka({
    clientId: config.kafkaProperties.kafkaClientId,
    brokers: config.kafkaProperties.kafkaBrokers,
  });

  publicReleaseProducer = kafka.producer();
  publicReleaseProducer.connect();
  publicReleaseTopic = config.kafkaProperties.producers.publicRelease.topic;

  // analysis updates indexing subscription
  analysisUpdatesConsumer = kafka.consumer({
    groupId: config.kafkaProperties.consumers.analysisUpdates.group,
    retry: {
      retries: 5,
      factor: 1.5,
    },
  });
  analysisUpdatesConsumer.subscribe({
    topic: config.kafkaProperties.consumers.analysisUpdates.topic,
  });
  analysisUpdatesConsumer.connect();

  const analysisDlq = config.kafkaProperties.consumers.analysisUpdates.dlq;
  if (analysisDlq) {
    analysisUpdatesDlqProducer = kafka.producer({
      allowAutoTopicCreation: true,
    });
    analysisUpdatesDlqProducer.connect();
  }
  // reindexing topic subscription
  const reindexingConsumer = kafka.consumer({
    groupId: config.kafkaProperties.consumers.reindexing.group,
  });
  reindexingConsumer.connect();

  reindexingConsumer.subscribe({
    topic: config.kafkaProperties.consumers.reindexing.topic,
  });

  analysisUpdatesConsumer
    .run({
      autoCommit: true,
      autoCommitThreshold: 10,
      autoCommitInterval: 10000,
      eachMessage: async ({ message }) => {
        logger.info(`New message received offset : ${message.offset}`);
        await handleAnalysisUpdate(message, analysisDlq);
        logger.debug(`Message handled ok`);
      },
    })
    .catch(e => {
      logger.error('Failed to run consumer ' + e.message, e);
      throw e;
    });

  return {
    analysisUpdatesConsumer,
    analysisUpdatesDlqProducer,
  };
};

export const sendPublicReleaseMessage = async (messageJSON: PublicReleaseMessage) => {
  const result = await publicReleaseProducer.send({
    topic: publicReleaseTopic,
    messages: [
      {
        value: JSON.stringify(messageJSON),
      },
    ],
  });
  logger.debug(`Message sent to topic ${publicReleaseTopic}, response: ${JSON.stringify(result)}`);
};

const sendDlqMessage = async (producer: Producer, dlqTopic: string, messageJSON: string) => {
  const result = await producer?.send({
    topic: dlqTopic,
    messages: [
      {
        value: JSON.stringify(messageJSON),
      },
    ],
  });
  logger.debug(`DLQ ${dlqTopic} message sent, response: ${JSON.stringify(result)}`);
};

async function handleAnalysisUpdate(message: KafkaMessage, analysisDlq: string | undefined) {
  try {
    await retry(
      async (bail: Function) => {
        // todo validate message body
        const analysisEvent = JSON.parse(message.value?.toString() || '{}') as AnalysisUpdateEvent;
        await analysisEventProcessor(analysisEvent);
      },
      {
        retries: 3,
        factor: 1,
      },
    );
  } catch (err) {
    logger.error(
      `Failed to handle analysis message, offset: ${message.offset}, message ${err.message}`,
      err,
    );
    if (analysisDlq && analysisUpdatesDlqProducer) {
      const msg = message.value
        ? JSON.parse(message.value.toString())
        : { message: `invalid body, original offset: ${message.offset}` };
      logger.debug(`Sending message to dlq...`);
      await sendDlqMessage(analysisUpdatesDlqProducer, analysisDlq, msg);
    }
  }
}
