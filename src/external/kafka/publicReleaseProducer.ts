import { Consumer, Kafka, KafkaMessage, Producer } from 'kafkajs';
import { KafkaProducerConfigurations } from '../../config';
import Logger from '../../logger';
const logger = Logger('Kafka.publicReleaseProducer');

let publicReleaseProducer: Producer;
let config: KafkaProducerConfigurations;

export const init = async (kafka: Kafka, producerConfig: KafkaProducerConfigurations) => {
  publicReleaseProducer = kafka.producer();
  await publicReleaseProducer.connect();
  config = producerConfig;
};

export const disconnect = async () => {
  await publicReleaseProducer?.disconnect();
};

export type Program = {
  id: string;
  donorsUpdated: string[];
};

export type PublicReleaseMessage = {
  id: string;
  publishedAt: Date;
  label: string;
  programs: Program[];
};

export const sendPublicReleaseMessage = async (messageJSON: PublicReleaseMessage) => {
  if (publicReleaseProducer) {
    const result = await publicReleaseProducer.send({
      topic: config.topic,
      messages: [
        {
          value: JSON.stringify(messageJSON),
        },
      ],
    });
    logger.debug(
      `Release message sent to topic ${config.topic}. Response: ${JSON.stringify(result)}`,
    );
  }
};
