import '../backend/utils/loadEnv';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from '../backend/utils/openai_shim';
import { createClient } from '../backend/utils/supabase_shim';
import { getCorrelationId, log, timeStart } from '../backend/utils/logger';
import { applyCors } from '../backend/utils/cors';
import { validateDecision } from '../backend/utils/validator';
import { signReadUrls } from '../backend/utils/storage';
import { uploadBatch } from '../backend/utils/openai_files';
import { ensureJpegForPaths } from '../backend/utils/image_converter.js';
import decisionSchema from '../backend/schema/renta_check_decision.json' assert { type: 'json' };

const MAX_RETRIES = Number(process.env.MAX_ANALYZE_RETRIES || 2);
const ANALYZE_MODEL = process.env.ANALYZE_MODEL || 'gpt-5-2025-08-07';
const REASONING_EFFORT = (process.env.REASONING_EFFORT || 'medium') as 'minimal' | 'low' | 'medium' | 'high';
const ENABLE_OPENAI = process.env.ENABLE_OPENAI === 'true';
const RAG_EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
const ENABLE_OPENAI_FILES = process.env.ENABLE_OPENAI_FILES === 'true';
const ENABLE_RESPONSES_API = process.env.ENABLE_RESPONSES_API === 'true';
const ENABLE_IMAGE_CONVERSION = process.env.ENABLE_IMAGE_CONVERSION !== 'false';
const ENABLE_EXOGENA_TEXT_EMBED = process.env.ENABLE_EXOGENA_TEXT_EMBED !== 'false';

async function fetchBuffer(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function extractExogenaText(url?: string, maxChars = 60000) {
  try {
    if (!url) return '';
    const XLSX = await import('xlsx');
    const buf = await fetchBuffer(url);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheets = wb.SheetNames || [];
    let out = '';
    for (const name of sheets.slice(0, 5)) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      out += `\n# Hoja: ${name}\n` + csv + '\n';
      if (out.length > maxChars) break;
    }
    return out.slice(0, maxChars);
  } catch {
    return '';
  }
}

async function extractExogenaHtml(url?: string, maxChars = 80000) {
  try {
    if (!url) return '';
    const XLSX: any = await import('xlsx');
    const buf = await fetchBuffer(url);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheets: string[] = wb.SheetNames || [];
    // Prefer sheets whose name mentions 'mov' to keep structure for Movimientos
    const ordered = [...sheets].sort((a, b) => {
      const sa = /mov/i.test(a) ? -1 : 0;
      const sb = /mov/i.test(b) ? -1 : 0;
      return sa - sb;
    });
    let htmlOut = '';
    for (const name of ordered.slice(0, 5)) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const html = XLSX.utils.sheet_to_html(ws, { id: name.replace(/\W+/g, '_') });
      htmlOut += `\n<!-- Hoja: ${name} -->\n` + html + '\n';
      if (htmlOut.length > maxChars) break;
    }
    return htmlOut.slice(0, maxChars);
  } catch {
    return '';
  }
}

async function summarizeExogena(url?: string) {
  try {
    if (!url) return {};
    const XLSX: any = await import('xlsx');
    const buf = await fetchBuffer(url);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheets: string[] = wb.SheetNames || [];
    let movimientosSum = 0;
    let movimientosSheet = '';
    for (const name of sheets) {
      if (!/mov/i.test(name)) continue;
      movimientosSheet = name;
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[cellAddr];
          if (!cell) continue;
          const v: any = cell.v;
          if (typeof v === 'number' && isFinite(v)) movimientosSum += v;
          else if (typeof v === 'string') {
            const num = Number(String(v).replace(/[^\d.-]/g, ''));
            if (!Number.isNaN(num) && isFinite(num)) movimientosSum += num;
          }
        }
      }
    }
    return { movimientos_sheet: movimientosSheet, movimientos_sum_cop: movimientosSum };
  } catch {
    return {};
  }
}
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function buildSystemPrompt() {
  const envPrompt = process.env.RENTACHECK_SYSTEM_PROMPT;
  if (envPrompt && envPrompt.trim()) return envPrompt;
  return [
    'Eres RentaCheck, experto tributario colombiano.',
    'Analiza archivos de exógena (.xlsx), prediales e impuestos de vehículo (imágenes/PDF).',
    'Prioriza prediales sobre exógena para patrimonio. Usa umbrales por UVT del año solicitado.',
    'Responde únicamente con JSON válido que cumpla el esquema renta_check_decision.',
    'No incluyas prosa adicional ni razones fuera del JSON.'
  ].join(' ');
}

async function runModelOnceStub(body: any) {
  const anio = Number(body?.anio_gravable || new Date().getFullYear());
  // Placeholder output. Phase 3 will replace this with OpenAI Responses call.
  return {
    anio_gravable: anio,
    debe_declarar: false,
    motivos: [
      'Patrimonio e ingresos por debajo de topes UVT estimados',
      'Sin indicios de consignaciones o consumos elevados'
    ],
    resumen: 'Resultado simulado. Implementación real llamará al modelo con structured outputs.',
    montos: {
      patrimonio_predial_total_cop: 0,
      patrimonio_exogena_cop: 0,
      ingresos_brutos_cop: 0,
      compras_consumos_cop: 0,
      retenciones_cop: 0
    },
    uvt: {
      valor_uvt_cop: 47065,
      anio_uvt: anio
    },
    prioridad_prediales_aplicada: false,
    verificaciones_rag: [],
    incertidumbres: ['Prototipo: falta análisis real de archivos'],
    archivos_detectados: {
      exogena: Array.isArray(body?.archivos?.exogena) ? body.archivos.exogena.length : 0,
      prediales: Array.isArray(body?.archivos?.prediales) ? body.archivos.prediales.length : 0,
      vehiculos: Array.isArray(body?.archivos?.vehiculos) ? body.archivos.vehiculos.length : 0
    }
  };
}

async function runModelOnceOpenAI(body: any, correlationId: string) {
  const anio = Number(body?.anio_gravable || new Date().getFullYear());
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Resolve signed read URLs from Supabase storage paths
  const exogena = Array.isArray(body?.archivos?.exogena) ? body.archivos.exogena : [];
  const prediales = Array.isArray(body?.archivos?.prediales) ? body.archivos.prediales : [];
  const vehiculos = Array.isArray(body?.archivos?.vehiculos) ? body.archivos.vehiculos : [];
  const allPaths: string[] = [];
  for (const it of [...exogena, ...prediales, ...vehiculos]) {
    if (it?.storage_path) allPaths.push(it.storage_path);
  }
  const signed = allPaths.length ? await signReadUrls(allPaths, Number(process.env.SIGNED_URL_EXPIRES || 3600)) : [];
  const urlByPath = new Map<string, string>();
  for (const r of signed) if (r.url) urlByPath.set(r.path, r.url);

  // Optionally normalize images to JPEG for model compatibility
  let predialPaths = prediales.map((x: any) => x.storage_path).filter(Boolean);
  let vehiculoPaths = vehiculos.map((x: any) => x.storage_path).filter(Boolean);
  const origPredialPaths = [...predialPaths];
  const origVehiculoPaths = [...vehiculoPaths];
  if (ENABLE_IMAGE_CONVERSION) {
    try {
      predialPaths = await ensureJpegForPaths(predialPaths);
      vehiculoPaths = await ensureJpegForPaths(vehiculoPaths);
    } catch {}
  }

  // Build a concise list of URLs per kind for the prompt
  const list = (paths: string[]) => paths.map((p) => ({ path: p, url: urlByPath.get(p) || null })).filter(Boolean);
  const filesSummary = {
    exogena: list(exogena.map((x: any) => x.storage_path).filter(Boolean)),
    prediales: list(predialPaths),
    vehiculos: list(vehiculoPaths),
  };

  // Log input manifest for observability: know exactly what the model receives
  try {
    log('info', correlationId, 'input_manifest', {
      exogena_paths: exogena.map((x: any) => x.storage_path).filter(Boolean),
      exogena_signed_count: filesSummary.exogena.filter((f: any) => !!f.url).length,
      predial_paths_original: origPredialPaths,
      predial_paths_used: predialPaths,
      vehiculo_paths_original: origVehiculoPaths,
      vehiculo_paths_used: vehiculoPaths,
    });
  } catch {}

  // Optionally upload files to OpenAI Files and capture file_ids
  let uploaded: { exogena: any[]; prediales: any[]; vehiculos: any[] } = { exogena: [], prediales: [], vehiculos: [] };
  if (ENABLE_OPENAI_FILES) {
    try {
      const batchExogena = await uploadBatch(filesSummary.exogena.map((f) => ({ path: f.path, url: f.url, filename: f.path.split('/').pop(), kind: 'exogena' })));
      const batchPred = await uploadBatch(filesSummary.prediales.map((f) => ({ path: f.path, url: f.url, filename: f.path.split('/').pop(), kind: 'predial' })));
      const batchVeh = await uploadBatch(filesSummary.vehiculos.map((f) => ({ path: f.path, url: f.url, filename: f.path.split('/').pop(), kind: 'vehiculo' })));
      uploaded = { exogena: batchExogena, prediales: batchPred, vehiculos: batchVeh } as any;
      log('info', correlationId, 'files_uploaded', {
        exogena: batchExogena.filter((x) => x.file_id).length,
        prediales: batchPred.filter((x) => x.file_id).length,
        vehiculos: batchVeh.filter((x) => x.file_id).length,
      });
    } catch (e: any) {
      log('warn', correlationId, 'files_upload_failed', { message: e?.message || String(e) });
    }
  }

  // Compose messages and enable function tools for RAG.
  const system = buildSystemPrompt();
  let exogenaText = '';
  if (ENABLE_EXOGENA_TEXT_EMBED) {
    const firstExUrl = filesSummary.exogena[0]?.url as string | undefined;
    exogenaText = await extractExogenaText(firstExUrl);
  }
  try { log('info', correlationId, 'exogena_embed', { length: exogenaText?.length || 0 }); } catch {}
  const counts = {
    exogena: exogena.length,
    prediales: prediales.length,
    vehiculos: vehiculos.length,
  };
  const userPreamble = [
    `Año gravable: ${anio}.`,
    'Archivos disponibles para análisis:',
    JSON.stringify({
      exogena: exogena.map((x) => x.storage_path),
      prediales: prediales.map((x) => x.storage_path),
      vehiculos: vehiculos.map((x) => x.storage_path),
    }),
    'Conteo de archivos detectados por tipo (si es 0, significa NO aportado y NO debe reportarse como faltante):',
    JSON.stringify(counts),
    exogenaText ? 'Contenido exógena (CSV truncado):\n' + exogenaText : '',
    ENABLE_OPENAI_FILES
      ? 'Archivos también subidos como OpenAI Files (usa si tu contexto lo permite):'
      : 'Además, usa los URLs firmados (OpenAI Files deshabilitado).',
    ENABLE_OPENAI_FILES
      ? JSON.stringify({
          exogena_file_ids: uploaded.exogena.filter((x: any) => x.file_id).map((x: any) => x.file_id),
          prediales_file_ids: uploaded.prediales.filter((x: any) => x.file_id).map((x: any) => x.file_id).slice(0, 5),
          vehiculos_file_ids: uploaded.vehiculos.filter((x: any) => x.file_id).map((x: any) => x.file_id).slice(0, 5),
        })
      : '',
    'Usa la función rag_search cuando necesites verificar topes UVT y reglas normativas.',
    'Devuelve únicamente un JSON válido que cumpla el esquema renta_check_decision. No agregues texto fuera del JSON.',
  ].filter(Boolean).join('\n');

  // Build image parts for vision (image_url). Chat Completions supports image URLs.
  const imageParts: any[] = [];
  for (const p of [...predialPaths, ...vehiculoPaths]) {
    const url = urlByPath.get(p);
    if (url) imageParts.push({ type: 'image_url', image_url: { url } });
  }

  // Define tool (function) for RAG
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'rag_search',
        description: 'Busca pasajes normativos relevantes usando búsqueda semántica en Supabase RAG.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            top_k: { type: 'integer', minimum: 1, maximum: 20 },
            threshold: { type: 'number', minimum: 0, maximum: 1 }
          },
          required: ['query']
        }
      }
    }
  ];

  const messagesBase: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text: userPreamble }, ...imageParts] },
  ];
  const responseFormat = { type: 'json_object' } as const;

  async function runToolLoop(msgs: any[]) {
    let messages = msgs.slice();
    let step = 0;
    let last: any = null;
    while (step < 3) {
      step++;
      const completion = await openai.chat.completions.create({
        model: ANALYZE_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        response_format: responseFormat,
      } as any);

      const choice = completion.choices?.[0];
      const msg = choice?.message as any;
      log('info', correlationId, 'usage', { prompt_tokens: completion?.usage?.prompt_tokens ?? 0, completion_tokens: completion?.usage?.completion_tokens ?? 0, total_tokens: completion?.usage?.total_tokens ?? 0 });

      if (msg?.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const call of msg.tool_calls) {
          const name = call.function?.name;
          const argsRaw = call.function?.arguments || '{}';
          let args: any = {};
          try { args = JSON.parse(argsRaw); } catch {}
          if (name === 'rag_search') {
            const { query, top_k = Number(process.env.RAG_TOP_K || 8), threshold = Number(process.env.RAG_THRESHOLD || 0.6) } = args || {};
            if (query && typeof query === 'string') {
              try {
                const emb = await openai.embeddings.create({ model: RAG_EMBEDDING_MODEL, input: query });
                const queryEmbedding = emb.data[0]?.embedding;
                const { data, error } = await supabase.rpc('match_sections', {
                  query_embedding: queryEmbedding,
                  match_threshold: threshold,
                  match_count: top_k,
                });
                if (error) throw error;
                const payload = { matches: data || [] };
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
                const best = Array.isArray(data) && data.length ? data[0].similarity : null;
                log('info', correlationId, 'rag_queries', { query: query.slice(0, 120), top_k, threshold, matches: (data || []).length, best_similarity: best });
              } catch (e: any) {
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: e?.message || String(e) }) });
                log('error', correlationId, 'error', { stage: 'rag_tool', message: e?.message || String(e) });
              }
            }
          }
        }
        continue;
      }
      last = msg?.content || '{}';
      break;
    }
    let parsed: any = {};
    try { parsed = typeof last === 'string' ? JSON.parse(last) : JSON.parse(String(last)); }
    catch { throw new Error('Model did not return valid JSON'); }
    return { parsed, messages };
  }

  // First pass
  let { parsed, messages } = await runToolLoop(messagesBase);

  // Validate and potentially correct result to align with server truth and ensure RAG usage
  const serverCounts = { exogena: exogena.length, prediales: prediales.length, vehiculos: vehiculos.length };
  const needCountsFix = !parsed.archivos_detectados
    || parsed.archivos_detectados.exogena !== serverCounts.exogena
    || parsed.archivos_detectados.prediales !== serverCounts.prediales
    || parsed.archivos_detectados.vehiculos !== serverCounts.vehiculos;
  const needRag = !Array.isArray(parsed.verificaciones_rag) || parsed.verificaciones_rag.length < 1;

  let corrections = 0;
  while ((needCountsFix || needRag) && corrections < 1) {
    corrections++;
    log('warn', correlationId, 'correction_pass', { needCountsFix, needRag });
    const fixText = [
      'Corrige y devuelve SOLO el JSON del esquema: ',
      needCountsFix ? `Ajusta 'archivos_detectados' EXACTAMENTE a ${JSON.stringify(serverCounts)}.` : '',
      needRag ? 'Realiza AL MENOS una llamada a rag_search para validar umbrales y obligaciones y refleja la(s) verificación(es) en verificaciones_rag.' : '',
    ].filter(Boolean).join('\n');
    messages.push({ role: 'user', content: [{ type: 'text', text: fixText }] });
    const res2 = await runToolLoop(messages);
    parsed = res2.parsed;
  }

  if (!parsed.archivos_detectados) parsed.archivos_detectados = serverCounts;
  if (!parsed.anio_gravable) parsed.anio_gravable = anio;

  return parsed;
}

async function runModelOnceResponses(body: any, correlationId: string) {
  const anio = Number(body?.anio_gravable || new Date().getFullYear());
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Prepare files
  const exogena = Array.isArray(body?.archivos?.exogena) ? body.archivos.exogena : [];
  const prediales = Array.isArray(body?.archivos?.prediales) ? body.archivos.prediales : [];
  const vehiculos = Array.isArray(body?.archivos?.vehiculos) ? body.archivos.vehiculos : [];
  const allPaths: string[] = [];
  for (const it of [...exogena, ...prediales, ...vehiculos]) if (it?.storage_path) allPaths.push(it.storage_path);
  const signed = allPaths.length ? await signReadUrls(allPaths, Number(process.env.SIGNED_URL_EXPIRES || 3600)) : [];
  const urlByPath = new Map<string, string>();
  for (const r of signed) if (r.url) urlByPath.set(r.path, r.url);

  // We will pass URLs directly to Responses API (simple inputs)
  // Optionally normalize images to JPEG for model compatibility
  let predialPaths = prediales.map((x: any) => x.storage_path).filter(Boolean);
  let vehiculoPaths = vehiculos.map((x: any) => x.storage_path).filter(Boolean);
  if (ENABLE_IMAGE_CONVERSION) {
    try {
      predialPaths = await ensureJpegForPaths(predialPaths);
      vehiculoPaths = await ensureJpegForPaths(vehiculoPaths);
    } catch {}
  }
  // Sign URLs for converted paths if needed
  const toSign = [...predialPaths, ...vehiculoPaths].filter(p => p && !urlByPath.has(p));
  if (toSign.length) {
    const extra = await signReadUrls(toSign, Number(process.env.SIGNED_URL_EXPIRES || 3600));
    for (const r of extra) if (r.url) urlByPath.set(r.path, r.url);
  }

  const system = buildSystemPrompt();
  const counts = { exogena: exogena.length, prediales: prediales.length, vehiculos: vehiculos.length };
  const userText = [
    `Año gravable: ${anio}.`,
    'Responde exclusivamente con JSON que cumpla el esquema renta_check_decision.',
    'Conteo de archivos detectados por tipo (0 = no aportado, NO reportar como faltante):',
    JSON.stringify(counts),
  ].join('\n');

  const userParts: any[] = [{ type: 'input_text', text: userText }];
  // Add Exógena as HTML and server-side summary for structure and reliability
  const MOV_UMBRAL_COP = Number(process.env.MOV_UMBRAL_COP || 65891000);
  let lastSum: any = {};
  for (const x of exogena.slice(0, 2)) {
    const url = urlByPath.get(x.storage_path);
    const html = await extractExogenaHtml(url);
    if (html) userParts.push({ type: 'input_text', text: 'HTML exógena (parcial):\n' + html });
    const sum = await summarizeExogena(url);
    lastSum = sum || {};
    if (sum && Object.keys(sum).length) {
      const hint = typeof sum.movimientos_sum_cop === 'number' && isFinite(sum.movimientos_sum_cop)
        ? `Pista del servidor: movimientos_sum_cop=${sum.movimientos_sum_cop} y umbral_1400UVT=${MOV_UMBRAL_COP} (verifica y usa como apoyo; NO ignores reglas).`
        : '';
      userParts.push({ type: 'input_text', text: 'Resumen automático (servidor) exógena: ' + JSON.stringify(sum) + (hint ? ('\n' + hint) : '') });
    }
  }
  // Attach exógena content as input_text (CSV) to ensure model can read it directly
  for (const x of exogena.slice(0, 2)) {
    const url = urlByPath.get(x.storage_path);
    const csv = await extractExogenaText(url);
    if (csv) userParts.push({ type: 'input_text', text: 'Contenido exógena (CSV truncado):\n' + csv });
  }
  // Attach images as input_image via image_url
  for (const p of predialPaths) {
    const url = urlByPath.get(p);
    if (url) userParts.push({ type: 'input_image', image_url: url });
  }
  for (const v of vehiculoPaths) {
    const url = urlByPath.get(v);
    if (url) userParts.push({ type: 'input_image', image_url: url });
  }

  // Pre-fetch RAG context to include top citations (no tool-calling fallback here)
  const ragQueries: string[] = [
    'umbral ingresos brutos 1.400 UVT año gravable 2024 obligación declarar',
    'umbral patrimonio bruto 4.500 UVT año gravable 2024 obligación declarar',
    'umbral compras consumos tarjetas consignaciones 1.400 UVT año gravable 2024',
    'responsable de IVA diciembre 2024 obligación declarar personas naturales',
  ];
  let ragBlock = '';
  try {
    for (const q of ragQueries) {
      const emb = await openai.embeddings.create({ model: RAG_EMBEDDING_MODEL, input: q });
      const queryEmbedding = emb.data[0]?.embedding;
      const { data } = await supabase.rpc('match_sections', { query_embedding: queryEmbedding, match_threshold: Number(process.env.RAG_THRESHOLD || 0.6), match_count: Number(process.env.RAG_TOP_K || 8) });
      const picks = (data || []).slice(0, 3).map((m: any, i: number) => `(${i + 1}) [${m.source}] score=${m.similarity?.toFixed(3)}\n${m.content}`);
      ragBlock += `\n### RAG: ${q}\n${picks.join('\n\n')}`;
    }
  } catch (e: any) {
    log('warn', correlationId, 'rag_prefetch_failed', { message: e?.message || String(e) });
  }
  if (ragBlock) userParts.unshift({ type: 'input_text', text: 'Contexto normativo (RAG extractos):\n' + ragBlock });

  // Create response
  async function callResponses(extraNote?: string) {
    const content = extraNote ? [{ type: 'input_text', text: extraNote }, ...userParts] : userParts;
    const resp: any = await openai.responses.create({
      model: ANALYZE_MODEL,
      reasoning: { effort: REASONING_EFFORT },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content },
      ],
    } as any);
    return resp;
  }

  const resp: any = await callResponses();

  // Log input items received by OpenAI (to verify it got files)
  try {
    const page: any = await (openai as any).responses.inputItems.list(resp.id);
    const items = Array.isArray(page?.data) ? page.data : [];
    const summary = items.reduce((acc: any, it: any) => {
      const t = it?.type || 'unknown';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    log('info', correlationId, 'responses_input_items', { response_id: resp.id, summary });
  } catch (e: any) {
    log('warn', correlationId, 'responses_input_items_failed', { message: e?.message || String(e) });
  }

  // Extract text
  let contentText = resp.output_text || '';
  if (!contentText && Array.isArray(resp.output)) {
    for (const o of resp.output) {
      if (Array.isArray(o?.content)) {
        for (const c of o.content) if (c?.type === 'output_text' && c?.text) contentText += c.text;
      }
    }
  }
  if (!contentText) throw new Error('Empty response from Responses API');
  let parsed: any;
  try { parsed = JSON.parse(contentText); } catch { throw new Error('Responses API did not return valid JSON'); }
  if (!parsed.archivos_detectados) parsed.archivos_detectados = counts;
  if (!parsed.anio_gravable) parsed.anio_gravable = anio;
  const usage = resp.usage || {};
  log('info', correlationId, 'usage', { model: ANALYZE_MODEL, api: 'responses', ...usage });
  // Correction pass for Responses path
  const needCountsFix = parsed.archivos_detectados.exogena !== counts.exogena || parsed.archivos_detectados.prediales !== counts.prediales || parsed.archivos_detectados.vehiculos !== counts.vehiculos;
  const needRag = !Array.isArray(parsed.verificaciones_rag) || parsed.verificaciones_rag.length < 1;
  const needMovCheck = typeof lastSum.movimientos_sum_cop === 'number' && lastSum.movimientos_sum_cop >= MOV_UMBRAL_COP && parsed.debe_declarar === false;
  if (needCountsFix || needRag || needMovCheck) {
    const note = [
      needCountsFix ? `Ajusta 'archivos_detectados' EXACTAMENTE a ${JSON.stringify(counts)}.` : '',
      needRag ? 'Incluye al menos una verificación normativa clara en verificaciones_rag basada en el contexto RAG provisto.' : '',
      needMovCheck ? `Reevalúa obligación: movimientos_sum_cop=${lastSum.movimientos_sum_cop} >= ${MOV_UMBRAL_COP} (1.400 UVT aprox 2024). Aplica reglas y devuelve SOLO el JSON.` : '',
      'Devuelve SOLO el JSON válido del esquema.'
    ].filter(Boolean).join('\n');
    const resp2: any = await callResponses(note);
    let text2 = resp2.output_text || '';
    if (!text2 && Array.isArray(resp2.output)) for (const o of resp2.output) if (Array.isArray(o?.content)) for (const c of o.content) if (c?.type === 'output_text' && c?.text) text2 += c.text;
    try { const parsed2 = JSON.parse(text2 || '{}'); if (parsed2 && typeof parsed2 === 'object') parsed = parsed2; } catch {}
  }
  return parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  const correlationId = getCorrelationId(req);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const stop = timeStart();
  const raw: any = (req as any).body;
  let body: any;
  try { body = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { body = {}; }

  // Log detected files
  try {
    const filesDetected = {
      exogena: Array.isArray(body?.archivos?.exogena) ? body.archivos.exogena.length : 0,
      prediales: Array.isArray(body?.archivos?.prediales) ? body.archivos.prediales.length : 0,
      vehiculos: Array.isArray(body?.archivos?.vehiculos) ? body.archivos.vehiculos.length : 0
    };
    log('info', correlationId, 'files_detected', filesDetected);
  } catch {}

  log('info', correlationId, 'api_call', {
    model: ANALYZE_MODEL,
    reasoning_effort: REASONING_EFFORT,
    strict: process.env.JSON_SCHEMA_STRICT === 'true',
    openai_enabled: ENABLE_OPENAI,
  });

  let attempt = 0;
  let lastErrors: string[] = [];
  let candidate: any = null;
  while (attempt < Math.max(1, MAX_RETRIES)) {
    attempt++;
    try {
      const t0 = timeStart();
      if (ENABLE_OPENAI) {
        if (ENABLE_RESPONSES_API) candidate = await runModelOnceResponses(body, correlationId);
        else candidate = await runModelOnceOpenAI(body, correlationId);
      }
      else candidate = await runModelOnceStub(body);
      const ms = t0();
      const valid = validateDecision(candidate);
      if (valid.ok) {
        log('info', correlationId, 'result', {
          debe_declarar: candidate.debe_declarar,
          motivos_count: Array.isArray(candidate.motivos) ? candidate.motivos.length : 0,
          verificaciones_rag: Array.isArray(candidate.verificaciones_rag) ? candidate.verificaciones_rag.length : 0,
          latency_ms: ms,
        });
        // usage already logged in OpenAI path; add placeholder for stub
        if (!ENABLE_OPENAI) log('info', correlationId, 'usage', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        res.status(200).json({ ...candidate, correlationId });
        return;
      } else {
        lastErrors = valid.errors;
        log('warn', correlationId, 'validation_failed', { attempt, errors: lastErrors });
      }
    } catch (err: any) {
      log('error', correlationId, 'error', { attempt, stage: 'model', message: err?.message || String(err) });
    }
  }

  log('error', correlationId, 'final_failure', { validation_errors: lastErrors, duration_ms: stop() });
  res.status(502).json({ error: 'Structured output validation failed', validation_errors: lastErrors, candidate, correlationId });
}