import retry from 'async-retry';
import { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs';

import { getAppConfig, KafkaConsumerConfiguration } from '../../config';
import recalculateFileEmbargo from '../../jobs/recalculateFileEmbargo';

import Logger from '../../logger';
const logger = Logger('Kafka.recalculateEmbargoConsumer');

let consumer: Consumer | undefined;

export const init = async (kafka: Kafka) => {
  const consumerConfig = (await getAppConfig()).kafkaProperties.consumers.recalculateEmbargo;

  consumer = kafka.consumer({
    groupId: consumerConfig.group,
    retry: {
      retries: 5,
      factor: 1.5,
    },
  });
  consumer.subscribe({
    topic: consumerConfig.topic,
  });
  await consumer.connect();

  consumer
    .run({
      autoCommit: true,
      autoCommitThreshold: 10,
      autoCommitInterval: 10000,
      eachMessage: async ({ message }) => {
        logger.info(`New message received offset : ${message.offset}`);
        await handleMessage();
        logger.debug(`Message handled ok`);
      },
    })
    .catch(e => {
      logger.error('Failed to run consumer.', e);
      throw e;
    });
};

export const disconnect = async () => {
  await consumer?.stop();
  await consumer?.disconnect();
};

async function handleMessage() {
  logger.info(`Initiating recalculate file embargo job...`);
  // No need to await for the job to complete...
  // A job failure will be logged, and the calculations will be redone at the next scheduled event.
  recalculateFileEmbargo();
  return;
}
