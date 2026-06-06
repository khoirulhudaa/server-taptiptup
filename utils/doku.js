const crypto = require('crypto');
const axios = require('axios');

const CLIENT_ID = process.env.DOKU_CLIENT_ID;
const SECRET_KEY = process.env.DOKU_SECRET_KEY;
const BASE_URL = process.env.DOKU_BASE_URL || 'https://api-sandbox.doku.com';

const generateSignature = (requestId, requestTimestamp, requestTarget, accessToken, body) => {
  const bodyHash = body
    ? crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64')
    : '';

  const componentSignature = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${requestTarget}`,
    bodyHash ? `Digest:SHA-256=${bodyHash}` : '',
  ].filter(Boolean).join('\n');

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(componentSignature)
    .digest('base64');

  return `HMACSHA256=${signature}`;
};

const dokuRequest = async (method, path, body = null) => {
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const signature = generateSignature(requestId, requestTimestamp, path, null, body);

  const headers = {
    'Client-Id': CLIENT_ID,
    'Request-Id': requestId,
    'Request-Timestamp': requestTimestamp,
    'Signature': signature,
    'Content-Type': 'application/json',
  };

  if (body) {
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64');
    headers['Digest'] = `SHA-256=${bodyHash}`;
  }

  const res = await axios({
    method,
    url: `${BASE_URL}${path}`,
    headers,
    data: body || undefined,
  });

  return res.data;
};

module.exports = { dokuRequest };