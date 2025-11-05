// kernel/scripts/check_sentinel.ts
// Quick verification helper to test sentinelClient + mockSentinel wiring.

import { setSentinelClient, recordEvent } from '../src/sentinelClient';
import { mockSentinel } from '../test/mocks/mockSentinel';

(async () => {
  try {
    mockSentinel.clear();
    setSentinelClient(mockSentinel as any);
    await recordEvent('auth.test', { ok: true });
    // Print captured events as JSON for easy verification
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(mockSentinel.getEvents(), null, 2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('check_sentinel failed:', (err as Error).stack || err);
    process.exit(1);
  }
})();

