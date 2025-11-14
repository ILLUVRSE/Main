import logger from '../logger';
import { loadConfig } from '../config/env';

type KafkaConsumerStopper = () => Promise<void>;

function loadKafka(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('kafkajs');
  } catch (err) {
    logger.warn('Kafka consumer requested but kafkajs dependency not installed', { err: (err as Error).message || err });
    return null;
  }
}

export function isKafkaEnabled(): boolean {
  const config = loadConfig();
  return Boolean(config.kafkaBrokers?.length && config.kafkaAuditTopic);
}

export async function startKafkaConsumer(handler: (event: any) => Promise<void>): Promise<KafkaConsumerStopper> {
  const config = loadConfig();
  if (!isKafkaEnabled()) {
    throw new Error('Kafka consumer not configured');
  }

  const kafkaLib = loadKafka();
  if (!kafkaLib) {
    throw new Error('kafkajs module not available');
  }

  const kafka = new kafkaLib.Kafka({
    clientId: config.kafkaClientId || 'sentinelnet',
    brokers: config.kafkaBrokers!,
  });

  const consumer = kafka.consumer({
    groupId: config.kafkaGroupId || 'sentinelnet-audit-consumer',
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: config.kafkaAuditTopic!,
    fromBeginning: config.kafkaFromBeginning,
  });

  await consumer.run({
    eachMessage: async ({ message, topic, partition }: any) => {
      try {
        if (!message?.value) {
          return;
        }
        const payload = message.value.toString('utf8');
        const event = JSON.parse(payload);
        await handler(event);
      } catch (err) {
        logger.warn('kafkaConsumer: failed to process event', {
          topic,
          partition,
          err: (err as Error).message || err,
        });
      }
    },
  });

  logger.info('Kafka audit consumer started', {
    brokers: config.kafkaBrokers,
    topic: config.kafkaAuditTopic,
    groupId: config.kafkaGroupId,
  });

  return async () => {
    try {
      await consumer.disconnect();
      logger.info('Kafka audit consumer stopped');
    } catch (err) {
      logger.warn('Kafka consumer disconnect failed', { err: (err as Error).message || err });
    }
  };
}

export default {
  isKafkaEnabled,
  startKafkaConsumer,
};
