const crypto = require('crypto');
const axios  = require('axios');
require('dotenv').config();

const CLIENT_ID  = "BRN-0203-1780730151932";
const SECRET_KEY = "SK-3bM8tQODtoZulU09RVOq";
const BASE_URL   = 'https://api-sandbox.doku.com';

const dokuRequest = async (method, path, body = null) => {
  const requestId        = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyString       = body ? JSON.stringify(body) : null;

  const isCheckout = path.startsWith('/checkout');

  // Component signature — Digest TIDAK dimasukkan untuk checkout
  const components = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${path}`,
  ];

  if (!isCheckout && bodyString) {
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('base64');
    components.push(`Digest:SHA-256=${bodyHash}`);
  }

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

  // Digest header juga tidak dikirim untuk checkout
  if (!isCheckout && bodyString) {
    const bodyHash = crypto.createHash('sha256').update(bodyString).digest('base64');
    headers['Digest'] = `SHA-256=${bodyHash}`;
  }

  console.log('[Doku] path:', path, '| isCheckout:', isCheckout);
  console.log('[Doku] componentSignature:\n', componentSignature);

  try {
    const res = await axios({
      method,
      url:  `${BASE_URL}${path}`,
      headers,
      data: bodyString || undefined,
    });
    return res.data;
  } catch (err) {
    console.error('[Doku Error]', err.response?.data);
    throw err;
  }
};

module.exports = { dokuRequest };