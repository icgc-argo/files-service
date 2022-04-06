import retry from 'async-retry';
import { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs';

import { getAppConfig } from '../../config';
import { SongAnalysis } from '../song';
import analysisEventProcessor from '../../jobs/processAnalysisEvent';

import Logger from '../../logger';
const logger = Logger('Kafka.clinicalUpdatesConsumer');

let clinicalUpdatesConsumer: Consumer | undefined;
let clinicalUpdatesDlqProducer: Producer | undefined;

export const init = async (kafka: Kafka) => {
  const consumerConfig = (await getAppConfig()).kafkaProperties.consumers.clinicalUpdates;

  clinicalUpdatesConsumer = kafka.consumer({
    groupId: consumerConfig.group,
    retry: {
      retries: 5,
      factor: 1.5,
    },
  });
  clinicalUpdatesConsumer.subscribe({
    topic: consumerConfig.topic,
  });
  await clinicalUpdatesConsumer.connect();

  const clinicalDlq = consumerConfig.dlq;
  if (clinicalDlq) {
    clinicalUpdatesDlqProducer = kafka.producer({
      allowAutoTopicCreation: true,
    });
    await clinicalUpdatesDlqProducer.connect();
  }

  await clinicalUpdatesConsumer
    .run({
      autoCommit: true,
      autoCommitThreshold: 10,
      autoCommitInterval: 10000,
      eachMessage: async ({ message }) => {
        logger.info(`New message received offset : ${message.offset}`);
        await handleAnalysisUpdate(message, clinicalDlq);
        logger.debug(`Message handled ok`);
      },
    })
    .catch(e => {
      logger.error('Failed to run consumer.', e);
      throw e;
    });
};

export const disconnect = async () => {
  await clinicalUpdatesConsumer?.stop();
  await clinicalUpdatesConsumer?.disconnect();
  await clinicalUpdatesDlqProducer?.disconnect();
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

async function handleAnalysisUpdate(message: KafkaMessage, clinicalDlq?: string) {
  try {
    await retry(
      async (_bail: Function) => {
        // TODO: validate message body
        const analysisEvent = JSON.parse(message.value?.toString() || '{}') as AnalysisUpdateEvent;
        await analysisEventProcessor(analysisEvent);
      },
      {
        retries: 3,
        factor: 1,
      },
    );
  } catch (err) {
    logger.error(`Failed to handle analysis message, offset: ${message.offset}`, err);
    if (clinicalDlq && clinicalUpdatesDlqProducer) {
      const msg = message.value
        ? JSON.parse(message.value.toString())
        : { message: `invalid body, original offset: ${message.offset}` };
      logger.debug(`Sending message to dlq...`);
      await sendDlqMessage(clinicalUpdatesDlqProducer, clinicalDlq, msg);
    }
  }
}
