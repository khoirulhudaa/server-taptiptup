const crypto = require('crypto');
const axios = require('axios');

const CLIENT_ID  = process.env.SBK_DOKU_CLIENT_ID;
const SECRET_KEY = process.env.SBK_DOKU_SECRET_KEY;
const BASE_URL   = process.env.SBK_DOKU_BASE_URL || 'https://api-sandbox.doku.com';

const generateSignature = (requestId, requestTimestamp, requestTarget, body) => {
  // Hash body dulu
  const bodyHash = body
    ? crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64')
    : '';

  // Komponen signature — urutan HARUS persis ini
  const components = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
  ];

  // Digest hanya ditambah kalau ada body
  if (bodyHash) components.push(`Digest:SHA-256=${bodyHash}`);

  const componentSignature = components.join('\n');

  console.log('[Doku Signature] Component:\n', componentSignature);

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(componentSignature)
    .digest('base64');

  return `HMACSHA256=${signature}`;
};

const dokuRequest = async (method, path, body = null) => {
  const requestId = crypto.randomUUID();

  // ← Format timestamp yang benar untuk Doku
  const now = new Date();
  const requestTimestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const signature = generateSignature(requestId, requestTimestamp, path, body);

  const headers = {
    'Client-Id':         CLIENT_ID,
    'Request-Id':        requestId,
    'Request-Timestamp': requestTimestamp,
    'Signature':         signature,
    'Content-Type':      'application/json',
  };

  // Digest header harus sama persis dengan yang di signature
  if (body) {
    const bodyHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('base64');
    headers['Digest'] = `SHA-256=${bodyHash}`;
  }

  console.log('[Doku Request]', method, `${BASE_URL}${path}`);
  console.log('[Doku Headers]', headers);

  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers,
      data: body || undefined,
    });
    return res.data;
  } catch (err) {
    console.error('[Doku Error Response]', err.response?.data);
    throw err;
  }
};

module.exports = { dokuRequest };