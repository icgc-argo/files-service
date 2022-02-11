import retry from 'async-retry';
import { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs';

import { KafkaConsumerConfigurations } from '../../config';
import { SongAnalysis } from '../song';
import analysisEventProcessor from '../../jobs/processAnalysisEvent';

import Logger from '../../logger';
const logger = Logger('Kafka.analysisUpdatesConsumer');

let analysisUpdatesConsumer: Consumer | undefined;
let analysisUpdatesDlqProducer: Producer | undefined;

export const init = async (kafka: Kafka, consumerConfig: KafkaConsumerConfigurations) => {
  analysisUpdatesConsumer = kafka.consumer({
    groupId: consumerConfig.group,
    retry: {
      retries: 5,
      factor: 1.5,
    },
  });
  analysisUpdatesConsumer.subscribe({
    topic: consumerConfig.topic,
  });
  await analysisUpdatesConsumer.connect();

  const analysisDlq = consumerConfig.dlq;
  if (analysisDlq) {
    analysisUpdatesDlqProducer = kafka.producer({
      allowAutoTopicCreation: true,
    });
    await analysisUpdatesDlqProducer.connect();
  }

  await analysisUpdatesConsumer
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
};

export const disconnect = async () => {
  await analysisUpdatesConsumer?.disconnect();
  await analysisUpdatesDlqProducer?.disconnect();
};

export type AnalysisUpdateEvent = {
  analysisId: string;
  studyId: string;
  state: string; // PUBLISHED, UNPUBLISHED, SUPPRESSED -> maybe more in the future so leaving this as string
  action: string; // PUBLISH, UNPUBLISH, SUPPRESS, CREATE -> future might add UPDATED
  songServerId: string;
  analysis: SongAnalysis;
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
  logger.debug(`DLQ message sent to ${dlqTopic}. response: ${JSON.stringify(result)}`);
};

async function handleAnalysisUpdate(message: KafkaMessage, analysisDlq?: string) {
  try {
    await retry(
      async (_bail: Function) => {
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
