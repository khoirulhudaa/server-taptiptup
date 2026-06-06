const crypto = require('crypto');
const axios = require('axios');

const CLIENT_ID  = process.env.SBK_DOKU_CLIENT_ID;
const SECRET_KEY = process.env.SBK_DOKU_SECRET_KEY;
const BASE_URL   = process.env.SBK_DOKU_BASE_URL || 'https://api-sandbox.doku.com';

const generateSignature = (requestId, requestTimestamp, requestTarget, body) => {
  const bodyString = body ? JSON.stringify(body) : '';
  const bodyHash = body
    ? crypto.createHash('sha256').update(bodyString).digest('base64')
    : '';

  const components = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
  ];

  if (bodyHash) components.push(`Digest:SHA-256=${bodyHash}`);

  const componentSignature = components.join('\n');

  console.log('=== SIGNATURE DEBUG ===');
  console.log('CLIENT_ID:', CLIENT_ID);
  console.log('SECRET_KEY length:', SECRET_KEY?.length);
  console.log('requestTarget:', requestTarget);
  console.log('componentSignature:\n', componentSignature);
  console.log('======================');

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(componentSignature)
    .digest('base64');

  return `HMACSHA256=${signature}`;
};

const dokuRequest = async (method, path, body = null) => {
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // ← Stringify SEKALI, pakai variabel yang sama untuk hash dan request
  const bodyString = body ? JSON.stringify(body) : null;

  const bodyHash = bodyString
    ? crypto.createHash('sha256').update(bodyString).digest('base64')
    : '';

  const components = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${path}`,
  ];
  if (bodyHash) components.push(`Digest:SHA-256=${bodyHash}`);

  const componentSignature = components.join('\n');

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(componentSignature)
    .digest('base64');

  const headers = {
    'Client-Id':         CLIENT_ID,
    'Request-Id':        requestId,
    'Request-Timestamp': requestTimestamp,
    'Signature':         `HMACSHA256=${signature}`,
    'Content-Type':      'application/json',
  };

  if (bodyHash) headers['Digest'] = `SHA-256=${bodyHash}`;

  console.log('[Body String]:', bodyString);
  console.log('[Body Hash]:', bodyHash);

  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers,
      // ← Kirim bodyString langsung, bukan re-stringify
      data: bodyString || undefined,
    });
    return res.data;
  } catch (err) {
    console.error('[Doku Error Response]', err.response?.data);
    throw err;
  }
};

module.exports = { dokuRequest };