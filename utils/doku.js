// utils/doku.js — FINAL
const crypto = require('crypto');
const axios  = require('axios');

const CLIENT_ID  = process.env.SBK_DOKU_CLIENT_ID;
const SECRET_KEY = process.env.SBK_DOKU_SECRET_KEY;
const BASE_URL   = process.env.SBK_DOKU_BASE_URL || 'https://api-sandbox.doku.com';

const dokuRequest = async (method, path, body = null) => {
  const requestId        = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bodyString       = body ? JSON.stringify(body) : null;

  // Digest wajib untuk POST
  const bodyHash = bodyString
    ? crypto.createHash('sha256').update(bodyString).digest('base64')
    : null;

  // Component signature — Digest WAJIB untuk POST
  const components = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${requestTimestamp}`,
    `Request-Target:${path}`,
  ];

  if (bodyHash) components.push(`Digest:${bodyHash}`);

  const componentSignature = components.join('\n');

  console.log('[Doku] componentSignature:\n', componentSignature);

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

  if (bodyHash) headers['Digest'] = bodyHash;

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