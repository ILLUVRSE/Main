import { AuditEvent } from '../../types';

export interface AuditPublisher {
  publish(event: AuditEvent): Promise<void>;
}

export class LogAuditPublisher implements AuditPublisher {
  async publish(event: AuditEvent): Promise<void> {
    console.log(`[AuditPublisher] Event published: ${event.eventType} (ID: ${event.id})`);
  }
}

// Stub for Kafka implementation. In real scenario, would use kafkajs
export class KafkaAuditPublisher implements AuditPublisher {
  constructor(private brokers: string[], private topic: string) {}

  async publish(event: AuditEvent): Promise<void> {
    // In a real implementation:
    // const producer = kafka.producer();
    // await producer.connect();
    // await producer.send({ topic: this.topic, messages: [{ value: JSON.stringify(event) }] });
    // await producer.disconnect();
    console.log(`[KafkaAuditPublisher] Published to ${this.topic}: ${event.id}`);
  }
}

export function getPublisher(): AuditPublisher {
  // If we had config for Kafka, we'd return KafkaAuditPublisher
  // For now, return LogAuditPublisher or a test mock
  return new LogAuditPublisher();
}
