import axios from 'axios';
import eventConsumer from '../src/event/consumer';

describe('event consumer', () => {
  test('polls audit search via mocked axios client and forwards events to handler', async () => {
    process.env.KERNEL_AUDIT_URL = 'http://kernel';
    const events = [
      { id: 'evt-1', ts: new Date().toISOString(), payload: { action: 'seed' } },
      { id: 'evt-2', ts: new Date(Date.now() + 10).toISOString(), payload: { action: 'seed-2' } },
    ];
    const post = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { events } })
      .mockResolvedValue({ status: 200, data: { events: [] } });
    const createSpy = jest.spyOn(axios, 'create').mockReturnValue({ post } as any);

    const received: string[] = [];
    const stop = eventConsumer.startConsumer(
      async (event) => {
        received.push(event.id);
      },
      { since: new Date(Date.now() - 1000).toISOString(), intervalMs: 10, limit: 10 },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await stop();

    expect(received).toEqual(expect.arrayContaining(['evt-1', 'evt-2']));

    createSpy.mockRestore();
    delete process.env.KERNEL_AUDIT_URL;
  });
});
