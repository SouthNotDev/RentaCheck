# Plan Técnico de Backend — RentaCheck (2025)

Estado: propuesta inicial listo para implementación
Elección de plataforma: Vercel (Serverless + Edge)
Modelos: OpenAI `gpt-5-2025-08-07` (sin fallbacks)
RAG: Supabase (Postgres + pgvector) vía MCP

---

## 1) Objetivo y alcance

- Automatizar el análisis para decidir si una persona debe declarar renta en Colombia.
- Entradas del usuario:
  - Exógena DIAN en `.xlsx`.
  - Predial/es (imágenes/PDF/otros) para avalúos catastrales (prioritarios frente a exógena).
  - Impuesto de vehículo(s) (imágenes/PDF/otros).
- El LLM realiza el procesamiento principal usando:
  - Structured Outputs (JSON Schema estricto, validado).
  - Razonamiento (con límites configurables) + verificación con RAG.
  - Herramientas para: inyectar archivos/imágenes y consultar RAG (Supabase) como tool.
- Observabilidad total: logs con trazabilidad de decisiones y payloads relevantes sin exponer secretos.


## 2) Arquitectura propuesta (alto nivel)

- Hosting: Vercel.
  - Serverless Functions (Node 18+) para endpoints REST (`/api/*`).
  - Edge Functions opcionales para rutas de baja latencia (p. ej., health, signed URLs).
  - Logs integrados en Vercel + IDs de correlación.
- Proveedores:
  - OpenAI API (Responses API) para razonamiento multimodal, tools y structured outputs.
  - Supabase: Postgres + `pgvector` para RAG; Storage opcional para archivos; Auth opcional.
- Flujo de análisis:
  1) Usuario sube archivos (UI → `/api/upload/init` → Supabase Storage signed URL → subir).
  2) UI llama `/api/analyze` con referencias de archivos (paths/IDs) y metadatos.
  3) Backend crea inputs del modelo (archivos/imágenes como tool inputs) y define JSON Schema.
  4) El modelo ejecuta:
     - Extracción/normalización de datos desde exógena y documentos (visión para imágenes).
     - Cálculo de patrimonio e ingresos; se priorizan prediales sobre exógena si hay conflicto.
     - Verificación normativa: tool `rag_search` (Supabase) para recuperar pasajes y citar.
     - Emite JSON final estricto con decisión y trazas de verificación.
  5) Backend valida JSON y responde a UI con el resultado + referencias a fuentes.


## 3) Razones para elegir Vercel

- Excelente DX con funciones serverless y soporte nativo a Node + streaming.
- Observabilidad y logs por despliegue, entornos y regiones.
- Facilidad para exponer API+frontend separados (UI en Vite permanece independiente).
- Alternativa: Netlify funcionaría, pero Vercel tiene mejor soporte y tooling para APIs de baja latencia y streaming de OpenAI.


## 4) Variables de entorno

Backend (.env, en Vercel Project Env):
- `OPENAI_API_KEY`: clave privada para OpenAI.
- `OPENAI_BASE_URL` (opcional si se usa el default).
- `SUPABASE_URL`: URL del proyecto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: clave service-role (solo en servidor) para indexado/ingesta.
- `SUPABASE_ANON_KEY`: opcional para consultas públicas con RLS (si aplica).
- `RENTACHECK_SYSTEM_PROMPT`: system prompt completo (texto multilínea); mantener en `.env`.
- `RAG_EMBEDDING_MODEL`: `text-embedding-3-small` (1536 dims) u otro consistente.
- `RAG_TABLE`: `public.document_sections` (por defecto del diseño abajo).
- `RAG_TOP_K`: `8` (default; ajustar por calidad/latencia).
- `REASONING_EFFORT`: `medium` (valores: minimal|low|medium|high) para reasoning models.
- `JSON_SCHEMA_STRICT`: `true` (fija uso de structured outputs estrictos).

Frontend (UI/.env, todas con prefijo VITE_):
- `VITE_API_BASE` (por ejemplo, `"/"` si mismo dominio o URL absoluta en producción).
- `VITE_ENABLE_REFERENCE_LINKS`: `true` para mostrar links de RAG en reporte.


## 5) RAG en Supabase (Postgres + pgvector)

Esquema recomendado (documentos normativos ya existentes en `Research for RAG/output/*`):

- Habilitar extensión y tabla de secciones:

```sql
-- Extensión vector (pgvector)
create extension if not exists vector with schema extensions;

-- Tabla de secciones (chunking del corpus normativo)
create table if not exists public.document_sections (
  id bigint primary key generated always as identity,
  source text not null,              -- nombre/URL/identificador del documento
  chunk_index int not null,          -- índice de chunk por documento
  content text not null,             -- texto del fragmento
  metadata jsonb default '{}'::jsonb,
  embedding halfvec(1536)            -- 1536 dims para text-embedding-3-small
);

-- Índice HNSW (cosine) recomendado
create index if not exists document_sections_embedding_hnsw
  on public.document_sections using hnsw (embedding halfvec_cosine_ops);
```

- Opcional RLS: si la colección es pública para todos los usuarios, se puede dejar sin RLS. Si se requiere multi-tenant, aplicar RLS por `owner_id` (ver guía "RAG with Permissions" de Supabase) y usar `auth.uid()` o Direct Postgres con `current_setting()`.

- Búsqueda semántica (RPC):

```sql
create or replace function public.match_sections(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
) returns table (
  id bigint,
  source text,
  chunk_index int,
  content text,
  similarity float
) language sql stable as $$
  select
    ds.id,
    ds.source,
    ds.chunk_index,
    ds.content,
    1 - (ds.embedding <=> query_embedding) as similarity
  from public.document_sections ds
  where 1 - (ds.embedding <=> query_embedding) > match_threshold
  order by (ds.embedding <=> query_embedding) asc
  limit least(match_count, 50);
$$;
```

- Ingesta desde `Research for RAG/output/*`:
  - Leer `corpus_normas_v3.jsonl` y/o `index_normas_v3.json`.
  - Chunking por ~700–1,000 tokens con solapamiento (si no existe ya en el JSONL).
  - Generar embeddings con `text-embedding-3-small` (1536 dims) y almacenar en `halfvec(1536)`.
  - Mantener `source` y `chunk_index` para citas precisas.

Referencias Supabase (MCP):
- pgvector y búsqueda: guías "pgvector: Embeddings and vector similarity", "Semantic search", "Vector columns", "RAG with Permissions".


## 6) API (Serverless en Vercel)

Rutas principales:

- `GET /api/health`
  - Responde `{ status: 'ok', time: ISO }`.

- `POST /api/upload/init`
  - Body: `{ files: [{ kind: 'exogena'|'predial'|'vehiculo', filename: string, mime?: string }] }`
  - Devuelve signed URLs/paths de Supabase Storage para subir desde el navegador y metadatos de referencia (`storage_path`).

- `POST /api/analyze`
  - Body (ejemplo):
    ```json
    {
      "anio_gravable": 2024,
      "archivos": {
        "exogena": [{ "storage_path": "uploads/exogena/uuid.xlsx" }],
        "prediales": [
          { "storage_path": "uploads/prediales/123.pdf" },
          { "storage_path": "uploads/prediales/456.jpg" }
        ],
        "vehiculos": [
          { "storage_path": "uploads/vehiculos/abc.pdf" }
        ]
      }
    }
    ```
  - Proceso interno:
    1) Resolver storage paths → URLs firmadas para lectura.
    2) Subir cada archivo a OpenAI Files si procede, o pasarlos como input de imágenes/archivos según soporte de Responses API.
    3) Preparar `input` multimodal (texto + `input_image`/`input_file`) y `tools`:
       - `rag_search`: tool que llama a Supabase RPC `match_sections` (vía MCP) con `{ query, top_k }`.
    4) Llamar a OpenAI Responses API con:
       - `model: 'gpt-5-2025-08-07'`.
       - `input`: system + user + archivos.
       - `response_format`: JSON Schema estricto (ver Sección 7).
       - `tool_choice: 'auto'` y `parallel_tool_calls: true`.
       - `reasoning_effort` desde env.
    5) Validar output contra schema; si inválido, reintentar con reprompt controlado.
    6) Registrar logs (trazas, tiempo, tokens, finish_reason, citas RAG).
    7) Responder a UI con JSON validado.

- `POST /api/rag/index` (protegido, admin)
  - Ingesta o reindexación del corpus local a Supabase (lee `Research for RAG/output/*`).

- `POST /api/rag/search` (tool backing)
  - Body: `{ query: string, top_k?: number, threshold?: number }`
  - Responde: `{ matches: [{ id, source, chunk_index, content, similarity }] }`

Notas de implementación:
- Para lectura de archivos por el modelo, aprovechamos soporte nativo del Responses API para inputs de imagen y archivos. En imágenes, usar `input_image` con file-id; en exógena, usar file-id como `input_file` si está habilitado en la cuenta. Si no, como compatibilidad, exponer URL temporal firmada y usar `image_url`/`file_url` si el SDK lo soporta.
- No usar OpenAI Vector Stores para RAG (regla del proyecto): todo RAG pasa por Supabase (MCP) y nuestras tools.


## 7) JSON Schema de salida (Structured Output)

Nombre: `renta_check_decision` (strict: true)

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "anio_gravable": { "type": "integer" },
    "debe_declarar": { "type": "boolean" },
    "motivos": { "type": "array", "items": { "type": "string" } },
    "resumen": { "type": "string" },
    "montos": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "patrimonio_predial_total_cop": { "type": "number" },
        "patrimonio_exogena_cop": { "type": "number" },
        "ingresos_brutos_cop": { "type": "number" },
        "compras_consumos_cop": { "type": "number" },
        "retenciones_cop": { "type": "number" }
      }
    },
    "uvt": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "valor_uvt_cop": { "type": "number" },
        "anio_uvt": { "type": "integer" }
      },
      "required": ["valor_uvt_cop", "anio_uvt"]
    },
    "prioridad_prediales_aplicada": { "type": "boolean" },
    "verificaciones_rag": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "query": { "type": "string" },
          "doc_id": { "type": "string" },
          "source": { "type": "string" },
          "match_score": { "type": "number" },
          "cita": { "type": "string" }
        },
        "required": ["query", "doc_id", "match_score"]
      }
    },
    "incertidumbres": { "type": "array", "items": { "type": "string" } },
    "archivos_detectados": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "exogena": { "type": "integer" },
        "prediales": { "type": "integer" },
        "vehiculos": { "type": "integer" }
      }
    }
  },
  "required": ["anio_gravable", "debe_declarar", "motivos", "uvt", "prioridad_prediales_aplicada"]
}
```

Validación:
- Usar `openai-node` helpers (`zodResponseFormat`) o `response_format: { type: 'json_schema', json_schema: {...}, strict: true }`.
- Reintentos con reprompt si el modelo responde incompleto o `finish_reason = length`.


## 8) System prompt (en `.env`)

`RENTACHECK_SYSTEM_PROMPT` (resumen funcional):

- Rol: "Eres RentaCheck, experto tributario colombiano."
- Tareas:
  - Analiza exógena `.xlsx` e identifica: ingresos, retenciones, compras/consumos, saldos, patrimonio reportado, etc.
  - Analiza prediales e impuestos vehiculares (imágenes/PDF) con visión; extrae avalúo catastral y demás campos clave. Prioriza prediales sobre exógena en caso de discrepancia de patrimonio.
  - Calcula patrimonio e ingresos consolidados y compáralos con umbrales UVT del año gravable.
  - Usa la tool `rag_search` para verificar reglas normativas, citar fuentes y confirmar umbrales y condiciones (p. ej., topes de patrimonio, ingresos, compras, consignaciones, retenciones, etc.).
  - Emite exclusivamente el JSON que cumple el esquema `renta_check_decision` (sin prosa adicional).
- Restricciones:
  - No reveles cadenas de pensamiento; resume razonamiento solo en campos del JSON.
  - Si falta evidencia, márcalo en `incertidumbres` y ajusta `motivos` y montos conservadoramente.


## 9) Definición de tools

- `rag_search` (function tool) → Supabase MCP
  - Input: `{ query: string, top_k?: number }`
  - Acción: generar embedding del `query` (mismo modelo que la base), llamar RPC `match_sections` y devolver top-k con `{ id, source, chunk_index, content, similarity }`.
  - Output hacia el modelo: `{ matches: [...] }`.

- Inyección de archivos/imágenes (OpenAI tools / inputs):
  - Imágenes (prediales, impuesto vehículo): usar `input_image` con `file_id` de OpenAI Files.
  - Archivos (exógena .xlsx): usar `input_file`/file-id si habilitado por Responses; alternativamente, `file_url` temporal firmada si el SDK lo soporta.
  - Compatibilidad de formatos: iPhone/HEIC y otros formatos no soportados por el modelo deben convertirse a JPEG/PNG antes de análisis.
    - Preferencia: conversión del lado del cliente (UI) antes de subir.
    - Alternativa: conversión previa al envío al modelo en un proceso auxiliar (script/worker); no convertir "en caliente" dentro de funciones serverless para no afectar latencia.

Notas:
- Evitar OpenAI Vector Stores para RAG.
- Mantener el mismo embedding model para query y base.


## 10) Secuencia de ejecución

1) UI sube archivos a Supabase Storage (vía signed URL).
2) UI llama `/api/analyze` con paths.
3) Backend resuelve URLs, crea Files en OpenAI si corresponde y construye `input` multimodal.
4) Backend configura tools (`rag_search`) y JSON Schema estricto.
5) LLM:
   - Extrae montos de cada fuente.
   - Prioriza prediales sobre exógena.
   - Verifica con `rag_search` pasajes normativos.
   - Devuelve JSON final estricto.
6) Backend valida y responde a UI; loguea todo.


## 11) Observabilidad y logs

- Correlation IDs: `x-request-id` por llamada.
- Logs estructurados (JSON) por etapa:
  - `api_call`: modelo, tool_choice, `reasoning_effort`, `prompt_cache_key` si aplica.
  - `files_detected`: listado y tamaños (no contenido).
  - `rag_queries`: query, top_k, tiempos, conteo.
  - `result`: `debe_declarar`, totales, citas.
  - `usage`: tokens prompt/completion, tiempo total, `finish_reason`.
  - `errors`: stack y etapa.
- No loguear secretos ni contenido sensible de archivos.


## 12) Seguridad

- Secretos solo en server (Vercel Env). Nunca exponer `SERVICE_ROLE_KEY` al cliente.
- Límite de tamaño de archivos y sanitización de nombres.
- Validación de MIME/extension lado servidor (whitelist: xlsx, pdf, jpg/jpeg, png).
- CORS restringido al dominio de UI en producción.
- RLS opcional si se maneja multi-tenant en RAG.


## 13) Consideraciones de producto/legales

- UVT y umbrales cambian anualmente: parametrizar por `anio_gravable`.
- Mostrar en UI las fuentes (links si `source` es una URL) y match score.
- Disclaimer legal en reporte final.


## 14) Roadmap de implementación

Fase 0: Infra
- Crear proyecto Supabase, habilitar `vector` y crear tabla/índice.
- Configurar Vercel proyecto backend (monorepo o repo separado del UI).
- Añadir variables de entorno en Vercel.

Fase 1: Ingesta RAG
- Script Node para leer `Research for RAG/output/*` y upsert en `document_sections`.
- Embeddings vía OpenAI `text-embedding-3-small`. Mantener consistencia de dims.

Fase 2: API mínima
- `/api/health`, `/api/upload/init` y `/api/rag/search` (tool backend).
- `/api/analyze` prototipo que retorna JSON estático (smoke test del schema).
 - Conversión opcional de imágenes no soportadas (HEIC→JPEG) como paso de build/test o en UI.

Fase 3: Integración LLM
- Llamada a Responses API `gpt-5-2025-08-07` con schema estricto.
- Inputs: imágenes como `input_image`; exógena como `input_file` o URL firmada.
- Tool `rag_search` operativo.
 - Normalización de formatos de imagen antes de invocar el modelo (reject/convert HEIC).

Fase 4: Validación y DX
- Lógica de reintentos si JSON inválido o incompleto.
- Telemetría de tiempos, tokens y costos.
- Ajuste de `RAG_TOP_K`, umbrales de similitud y prompts.

Fase 5: Endurecimiento
- Validaciones de archivos, límites de tamaño y formatos.
- Pruebas manuales con casos reales.
- Documentación operativa y de soporte.


## 15) Snippets de referencia (SDK OpenAI + Supabase)

OpenAI Node (structured output con Zod):

```ts
import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const Decision = z.object({
  anio_gravable: z.number(),
  debe_declarar: z.boolean(),
  motivos: z.array(z.string()),
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const completion = await client.chat.completions.parse({
  model: 'gpt-5-2025-08-07',
  messages: [
    { role: 'system', content: process.env.RENTACHECK_SYSTEM_PROMPT! },
    { role: 'user', content: 'Analiza los archivos y decide.' }
  ],
  response_format: zodResponseFormat(Decision, 'renta_check_decision'),
});

const decision = completion.choices[0]?.message.parsed;
```

OpenAI Files (subida rápida):

```ts
import fs from 'node:fs';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

const client = new OpenAI();
await client.files.create({
  file: fs.createReadStream('uploads/exogena/uuid.xlsx'),
  purpose: 'input', // propósito para Responses/inputs
});
```

Supabase RPC para búsqueda:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function ragSearch(queryEmbedding: number[], topK = 8, threshold = 0.7) {
  const { data, error } = await supabase.rpc('match_sections', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: topK,
  });
  if (error) throw error;
  return data;
}
```


## 16) Riesgos y mitigaciones

- Soporte de `.xlsx` como input directo del modelo: en la mayoría de cuentas Responses acepta file-ids; si hubiera limitación, usar URL firmada o conversión a CSV previa (solo embalaje, el análisis lo hace el LLM) manteniendo la regla de "procesamiento en el modelo".
- Calidad de OCR/visión para imágenes: usar imágenes nítidas; si baja confianza, el JSON debe reflejar `incertidumbres`.
- Derivas del modelo con JSON: usar `strict: true`, zod o JSON Schema y reintentos.
- Costos/latencia: limitar `top_k`, optimizar chunking y usar `reasoning_effort` adecuado.


## 17) Checklist de despliegue

- [ ] Supabase: extensión `vector` habilitada, tabla e índice creados.
- [ ] Carga inicial del corpus a `document_sections` con embeddings consistentes.
- [ ] Vercel: variables de entorno, secretos y build OK.
- [ ] Endpoints `/api/health`, `/api/upload/init`, `/api/rag/search`, `/api/analyze` operativos.
- [ ] Logs verifican: archivos detectados, tool calls, RAG y decisión.
- [ ] UI consume resultado y muestra fuentes/justificación.


---

Referencias (MCP Context7 / Docs):
- OpenAI Node (structured outputs, tools, files): openai-node helpers y API (zodResponseFormat, runTools, files.create, responses input multimodal).
- OpenAI Platform (Structured Outputs, Responses API, tools, file/image inputs, reasoning_effort).
- Supabase (pgvector, semantic search, RAG con RLS, vector columns, automatic embeddings).