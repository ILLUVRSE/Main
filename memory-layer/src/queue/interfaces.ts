
export interface IQueueItem {
  id: string; // Unique ID for deduplication/tracking
  content: string;
  metadata: Record<string, any>;
  attempts: number;
  nextRetry?: Date;
}

export interface IQueue {
  /**
   * Enqueues an item for processing.
   */
  enqueue(item: Omit<IQueueItem, 'attempts'>): Promise<void>;

  /**
   * Dequeues the next available item.
   */
  dequeue(): Promise<IQueueItem | null>;

  /**
   * Acknowledges successful processing of an item.
   */
  ack(id: string): Promise<void>;

  /**
   * Negatively acknowledges an item (failed processing).
   * Schedules retry.
   */
  nack(id: string, nextRetry: Date): Promise<void>;

  /**
   * Moves an item to dead letter queue.
   */
  deadLetter(id: string, reason: string): Promise<void>;
}
