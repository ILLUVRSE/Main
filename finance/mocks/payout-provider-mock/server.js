const http = require('http');
const url = require('url');

const payouts = new Map();

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (req.method === 'POST' && parsed.pathname === '/payouts') {
    try {
      const body = await parseBody(req);
      const providerReference = `mock_${body.payoutId}`;
      const record = {
        payoutId: body.payoutId,
        providerReference,
        status: 'settled',
        settledAt: new Date().toISOString(),
      };
      payouts.set(body.payoutId, record);
      return json(res, 202, record);
    } catch (err) {
      return json(res, 400, { message: err.message });
    }
  }

  if (req.method === 'POST' && parsed.pathname?.startsWith('/payouts/') && parsed.pathname.endsWith('/settle')) {
    const payoutId = parsed.pathname.split('/')[2];
    const record = payouts.get(payoutId);
    if (!record) return json(res, 404, { message: 'not found' });
    record.status = 'settled';
    record.settledAt = new Date().toISOString();
    return json(res, 200, record);
  }

  if (req.method === 'GET' && parsed.pathname === '/settlements') {
    return json(res, 200, Array.from(payouts.values()));
  }

  res.statusCode = 404;
  res.end('not found');
});

const port = process.env.PORT || 4100;
server.listen(port, () => {
  console.log(`payout-provider-mock listening on ${port}`);
});
