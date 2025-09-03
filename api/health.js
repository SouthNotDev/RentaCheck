const { VercelRequest, VercelResponse } = require('@vercel/node');

async function handler(req, res) {
  try {
    // Minimal CORS for Vercel Dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req?.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.status(200).send({ status: 'ok', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).send({ error: e?.message || 'health_failed' });
  }
}

module.exports = handler;