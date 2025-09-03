#!/usr/bin/env node
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { randomUUID } = require('node:crypto');

// Load environment variables
dotenv.config({ path: './.env' });
dotenv.config({ path: './.env.local' });

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
// Accept JSON and text bodies (UI envía text/plain para evitar preflight)
app.use(express.text({ type: ['text/*', 'application/json'] }));
app.use(express.json());
// CORS y preflight
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Correlation-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
// Logging estructurado por request/response
app.use((req, res, next) => {
  const headerId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const correlationId = headerId || randomUUID();
  res.setHeader('X-Correlation-Id', correlationId);
  req.correlationId = correlationId;
  const start = Date.now();
  let bodyPreview = undefined;
  try {
    if (typeof req.body === 'string') bodyPreview = req.body.slice(0, 1000);
    else if (req.body) bodyPreview = JSON.stringify(req.body).slice(0, 1000);
  } catch {}
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'http_request', correlationId, method: req.method, path: req.path, origin: req.headers.origin || null, body_preview: bodyPreview }));
  } catch {}
  res.on('finish', () => {
    try {
      const duration_ms = Date.now() - start;
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'http_response', correlationId, status: res.statusCode, duration_ms }));
    } catch {}
  });
  next();
});

// Import API handlers (JS for local dev)
const healthHandler = require('./api/health.js');
const uploadInitHandler = require('./api/upload/init.js');
const uploadSignReadHandler = require('./api/upload/sign-read.js');
const analyzeHandler = require('./api/analyze.js');
const ragSearchHandler = require('./api/rag/search.js');
const ragIndexHandler = require('./api/rag/index.js');
const mpPreferenceHandler = require('./api/pay/mp-preference.js');
const mpWebhookHandler = require('./api/pay/mp-webhook.js');

// Routes
app.get('/api/health', (req, res) => healthHandler(req, res));
// Preflight global ya está arriba; usamos POST aquí
app.post('/api/upload/init', (req, res) => uploadInitHandler(req, res));
app.post('/api/upload/sign-read', (req, res) => uploadSignReadHandler(req, res));
app.post('/api/analyze', (req, res) => analyzeHandler(req, res));
app.post('/api/rag/search', (req, res) => ragSearchHandler(req, res));
app.post('/api/rag/index', (req, res) => ragIndexHandler(req, res));
app.post('/api/pay/mp-preference', (req, res) => mpPreferenceHandler(req, res));
app.all('/api/pay/mp-webhook', (req, res) => mpWebhookHandler(req, res));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});