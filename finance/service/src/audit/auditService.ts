export interface AuditEvent {
  eventType: string;
  actor: string;
  role?: string;
  subjectId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class AuditService {
  private events: AuditEvent[] = [];

  async record(event: Omit<AuditEvent, 'createdAt'>): Promise<void> {
    this.events.push({ ...event, createdAt: new Date().toISOString() });
  }

  getEvents(): AuditEvent[] {
    return this.events;
  }
}
