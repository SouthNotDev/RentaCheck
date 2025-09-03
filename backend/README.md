Backend — RentaCheck (Vercel API)

This backend runs as Vercel Serverless Functions under `/api/*` and is the canonical path used by the app.

Endpoints
- `GET /api/health`: basic health check (used by scripts and uptime monitors).
- `POST /api/upload/init`: returns signed upload URLs for Supabase Storage. Body: `{ files: [{ kind, filename, mime, size }] }` with kinds `exogena|predial|vehiculo`.
- `POST /api/upload/sign-read`: returns signed read URLs for previously uploaded `storage_path`s.
- `POST /api/analyze`: main decision endpoint. Receives `{ anio_gravable, archivos: { exogena: [{storage_path}], prediales: [...], vehiculos: [...] } }` and returns a JSON that matches `backend/schema/renta_check_decision.json`.
- `POST /api/rag/search`: semantic search via Supabase pgvector RPC `match_sections` (used as a tool by the model).
- `POST /api/rag/index`: admin helper to run `backend/scripts/ingest-rag.js` (guarded by `X-Admin-Token`).

Local Development
- Quick dev server (Express): `npm run dev` (or `node server.js`). Routes are proxied to handlers under `api/`. For fast iteration, `/api/analyze` uses a simple stub at `api/analyze.js` unless the Vercel TypeScript handler is used in deploy.
- Vercel dev (uses TypeScript handlers): `vercel dev` (requires Vercel CLI). This path uses `api/*.ts`, including the full `/api/analyze.ts` with structured outputs and RAG.
- E2E smoke (uses signed URLs): `node backend/scripts/dev-test-analyze.js http://127.0.0.1:3000` or replace base URL with your deployed Vercel domain. This script:
  - Calls `/api/health`
  - Calls `/api/upload/init` for three sample files under `files-for-test-only`
  - Uploads to Supabase via signed URLs
  - Calls `/api/analyze` and prints the decision

Environment Variables
- Core (required for uploads/RAG):
  - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: Supabase project and service role key.
  - `UPLOADS_BUCKET` (default: `uploads`): Supabase Storage bucket.
  - `SIGNED_URL_EXPIRES` (seconds, default `3600`): expiry for read URLs.
  - `CORS_ALLOWED_ORIGINS`: comma‑separated origins. Use `*` in dev.
- OpenAI (enable model path):
  - `OPENAI_API_KEY`: required when `ENABLE_OPENAI=true`.
  - `ANALYZE_MODEL` (default: `gpt-5-2025-08-07`): required model per product rules.
  - `REASONING_EFFORT` (`minimal|low|medium|high`, default `medium`).
  - `ENABLE_OPENAI` (`true|false`, default `false`): toggles real model vs stub.
  - `ENABLE_RESPONSES_API` (`true|false`, default `true`): use Responses API (preferred) vs Chat Completions tools path.
  - `ENABLE_OPENAI_FILES` (`true|false`, default `false`): uploads inputs to OpenAI Files.
- RAG:
  - `RAG_EMBEDDING_MODEL` (default: `text-embedding-3-small`).
  - `RAG_TOP_K` (default: `8`), `RAG_THRESHOLD` (default: `0.6`).
- Images/Extraction:
  - `ENABLE_IMAGE_CONVERSION` (`true|false`, default `true`): convert HEIC/others to JPEG in Storage when possible.
  - `ENABLE_EXOGENA_TEXT_EMBED` (`true|false`, default `true`): also embed exógena CSV/HTML extracts in the prompt.
  - `MOV_UMBRAL_COP` (default ~`65891000`): 1,400 UVT reference to cross‑check movimientos.
- Admin:
  - `ADMIN_TOKEN`: required header `X-Admin-Token` for `/api/rag/index`.
- Logging:
  - `LOG_LEVEL` (`debug|info|warn|error`, default `info`).

RAG Schema & Ingest
- SQL: `backend/supabase/rag_schema.sql` creates `public.document_sections`, HNSW index and RPC `match_sections`.
- Apply via script: `SUPABASE_DB_URL=postgres://... node backend/scripts/apply-rag-schema.js` or print SQL with `--print` and run in Supabase SQL editor.
- Ingest: `node backend/scripts/ingest-rag.js` (reads `Research for RAG/output/*`, embeds with OpenAI, upserts into `document_sections`).

Observability
- Every request emits structured logs with a correlation ID: see `backend/utils/logger.ts`.
- `/api/analyze.ts` logs: files detected, input manifest (counts/paths), exógena embed length, usage, validation and final result.
- Ensure Vercel project logs are retained; you should be able to debug solely from logs as per product objective.

Contracts & Schema
- The output of `/api/analyze` must validate against `backend/schema/renta_check_decision.json`. Validation uses Ajv in the handler.
- The handler will retry (up to `MAX_ANALYZE_RETRIES`) if the model's JSON fails validation, and finally returns `502` with details.

Notes
- The Express dev server exists for local convenience; the source of truth is the Vercel `api/*.ts` functions.
- Model calls are disabled by default (`ENABLE_OPENAI=false`) to avoid accidental usage; enable in Vercel once secrets are set and RAG is ingested.