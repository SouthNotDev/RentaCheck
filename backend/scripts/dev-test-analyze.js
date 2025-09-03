#!/usr/bin/env node
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Load environment variables from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env.local') });

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const ROOT = process.cwd();
const TEST_DIR = path.resolve(ROOT, '../files-for-test-only');

function guessMime(filename) {
  const f = filename.toLowerCase();
  if (f.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (f.endsWith('.pdf')) return 'application/pdf';
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.heic')) return 'image/heic';
  return 'application/octet-stream';
}

async function uploadViaSignedUrl(signedUrl, token, filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': mime },
    body: buf,
  });
  if (!res.ok) throw new Error(`Upload failed ${res.status}`);
}

async function main() {
  // Preflight health check
  try {
    const h = await fetch(`${BASE}/api/health`);
    const txt = await h.text();
    console.log('health:', h.status, txt);
  } catch (e) {
    console.error('health-check failed:', e?.message || e);
    throw e;
  }
  const exo = 'reporteExogena2024 (1).xlsx';
  const p1 = 'predial_1.HEIC';
  const p2 = 'predial_2.HEIC';
  for (const f of [exo, p1, p2]) {
    const fp = path.join(TEST_DIR, f);
    if (!fs.existsSync(fp)) throw new Error(`Missing test file: ${fp}`);
  }

  // 1) Request signed uploads
  const files = [
    { kind: 'exogena', filename: exo, mime: guessMime(exo), size: fs.statSync(path.join(TEST_DIR, exo)).size },
    { kind: 'predial', filename: p1, mime: guessMime(p1), size: fs.statSync(path.join(TEST_DIR, p1)).size },
    { kind: 'predial', filename: p2, mime: guessMime(p2), size: fs.statSync(path.join(TEST_DIR, p2)).size },
  ];
  const initRes = await fetch(`${BASE}/api/upload/init`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files })
  });
  const initJson = await initRes.json();
  if (!initRes.ok) throw new Error(`upload/init failed: ${initRes.status} ${JSON.stringify(initJson)}`);
  console.log('upload/init:', initJson.bucket, 'files:', initJson.files.length, 'correlationId:', initJson.correlationId);

  // 2) Upload each file to Supabase Storage
  for (const f of initJson.files) {
    const localName = f.filename;
    const localPath = path.join(TEST_DIR, localName);
    await uploadViaSignedUrl(f.upload_url, f.token, localPath, guessMime(localName));
    console.log('Uploaded:', localName, '->', f.storage_path);
  }

  // 3) Call analyze
  const exogena = initJson.files.filter(x => x.kind === 'exogena').map(x => ({ storage_path: x.storage_path }));
  const prediales = initJson.files.filter(x => x.kind === 'predial').map(x => ({ storage_path: x.storage_path }));
  const body = { anio_gravable: 2024, archivos: { exogena, prediales, vehiculos: [] } };
  const analyzeRes = await fetch(`${BASE}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const analyzeJson = await analyzeRes.json();
  console.log('analyze status:', analyzeRes.status);
  console.log('decision:', analyzeJson);
}

main().catch((e) => { console.error('dev-test-analyze failed:', e?.message || e); process.exit(1); });