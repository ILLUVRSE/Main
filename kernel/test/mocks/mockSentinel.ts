// kernel/test/mocks/mockSentinel.ts
// Minimal test double for Sentinel / audit events.
// Tests can import the singleton and assert on emitted events.
//
// Usage (example in a test):
//   import { mockSentinel } from '../../test/mocks/mockSentinel';
//   mockSentinel.clear();
//   // exercise code that should emit events
//   expect(mockSentinel.findByType('auth.login').length).toBeGreaterThan(0);

export type SentinelEvent = {
  ts: string;
  type: string;
  payload?: any;
};

class MockSentinel {
  private events: SentinelEvent[] = [];

  record(type: string, payload?: any) {
    const ev: SentinelEvent = { ts: new Date().toISOString(), type, payload };
    this.events.push(ev);
  }

  getEvents(): SentinelEvent[] {
    return [...this.events];
  }

  findByType(type: string): SentinelEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }
}

export const mockSentinel = new MockSentinel();
export default mockSentinel;

