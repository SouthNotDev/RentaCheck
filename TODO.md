# TODO — RentaCheck Backend/RAG/Integración

Estado: inicial. Marca con [x] al completar.

## 0) Preparación e Infra
- [ ] Crear proyecto Supabase (producción y dev/preview si aplica)
- [ ] Habilitar extensión `vector` (pgvector) en Supabase
- [ ] Configurar variables de entorno en Vercel (OPENAI/SUPABASE/etc.)
- [ ] Definir dominios y CORS para UI

## 1) Esquema RAG en Supabase
- [x] Crear tabla `public.document_sections` (SQL listo en `backend/supabase/rag_schema.sql`)
- [x] Crear índice HNSW `vector_cosine_ops` (SQL listo)
- [x] Crear función RPC `match_sections(query_embedding, match_threshold, match_count)` (SQL listo)
- [ ] (Opcional) Definir RLS si multi-tenant

## 2) Ingesta del Corpus
- [x] Script Node para leer `Research for RAG/output/*` (`backend/scripts/ingest-rag.js`)
- [ ] Chunking y normalización (si el JSONL no viene chunked)
- [x] Generar embeddings (`text-embedding-3-small`, 1536 dims)
- [x] Upsert a `document_sections` (idempotente)
- [x] Verificación de conteos e indexación (`backend/scripts/verify-rag.js`)
 - [ ] Ejecutar SQL de esquema vía Supabase MCP (crear RPC/tabla/índice)
 - [ ] Ejecutar `npm run -w backend rag:ingest` y `rag:verify` después del SQL

## 3) Proyecto Backend (Vercel)
- [x] Inicializar estructura `/api` (serverless functions)
- [x] `GET /api/health`
- [x] `POST /api/upload/init` → Signed URLs Supabase Storage
- [x] `POST /api/upload/sign-read` → Signed URLs de lectura para `storage_path`
- [x] `POST /api/rag/search` → proxy a RPC `match_sections`
- [x] `POST /api/rag/index` (admin) → ingesta/rehash bajo auth
- [ ] Crear bucket `uploads` en Supabase Storage (script/guía pendiente)

## 4) Integración OpenAI (Responses API)
- [x] Utilidad para subir archivos a OpenAI Files (exógena `.xlsx`) (`backend/utils/openai_files.ts`)
- [x] Utilidad para tratar imágenes (prediales/vehículos) como `input_image` (chat `image_url`; uploads opcionales via `ENABLE_OPENAI_FILES`)
 - [x] Definir tool `rag_search` (función con embeddings + RPC Supabase desde analyze)
- [x] Definir schema JSON estricto (`renta_check_decision`) (`backend/schema/renta_check_decision.json`)
- [x] Implementar `POST /api/analyze` (TypeScript en Vercel, stub por defecto):
  - [x] Resolver `storage_path` → URL firmada
  - [x] Subir a OpenAI Files si aplica (guardado por `ENABLE_OPENAI_FILES`)
  - [x] Construir tools y loop de function-calling (rag_search) para Chat Completions
- [x] Añadir camino alterno con Responses API (`ENABLE_RESPONSES_API`) con `response_format: json_schema` estricto
- [x] Llamar a `gpt-5-2025-08-07` y validar con Ajv
 - [ ] Corregir y estabilizar payload de Responses API para adjuntar `input_file` (.xlsx) e `input_image` (file_id) y usar schema estricto en producción
  - [x] Validar salida con JSON Schema (Ajv)
  - [x] Reintentos controlados si inválido/incompleto (estructura lista)

## 5) System Prompt y Reglas de Negocio
- [ ] Escribir `RENTACHECK_SYSTEM_PROMPT` (prioriza prediales sobre exógena)
- [ ] Parametrizar UVT por año (`anio_gravable`)
- [ ] Modelar campos de salida (montos, motivos, verificaciones RAG)

## 6) Observabilidad y Logs
- [x] Correlation ID por request (utils `backend/utils/logger.ts`)
- [x] Logs estructurados: inputs detectados y rag_queries (api/* actualizados)
- [x] Métricas: tiempos por etapa (latency_ms); tokens placeholder para integrate en fase 3
- [x] Registro de resultados y errores (sin secretos)
- [x] Propagar `correlationId` al UI y mostrarlo en estados/errores
 - [x] Loguear tamaño del extracto de exógena embebido (si `ENABLE_EXOGENA_TEXT_EMBED=true`)

## 7) Seguridad
- [x] Validación de extensión/MIME y tamaño en `/api/upload/init`
- [x] Sanitizar nombres y paths de archivos subidos
- [ ] Mantener claves en server (no exponer service-role)
- [ ] CORS limitado a dominio de UI en prod
- [ ] RLS opcional si multi-tenant en RAG
- [ ] Crear bucket `uploads` con restricciones

## 12) Compatibilidad de Imágenes (Conversión)
- [x] Soportar HEIC en Storage policy para pruebas (no recomendado en prod)
- [x] Conversión server-side previa al análisis (cuando sea posible): `ENABLE_IMAGE_CONVERSION=true` + `backend/utils/image_converter.js` (sharp)
- [x] Conversión local para dev (HEIC→JPEG vía sips): `backend/utils/heic_converter.js` y uso en `backend/scripts/e2e-upload-and-analyze.js`
- [ ] UI: convertir HEIC/formatos no soportados a JPEG/PNG antes de subir
- [ ] Backend: en prod, rechazar HEIC con mensaje claro si no hay conversión disponible
- [ ] (Opcional) Servicio/worker de conversión asíncrona si se requiere server-side

## 13) Exógena (.xlsx)
- [x] Embebido opcional de contenido CSV truncado (`ENABLE_EXOGENA_TEXT_EMBED=true`) para el camino Chat
- [ ] Preferir Responses API con `input_file` para que el modelo lea la exógena directamente (evitar embebido de texto en prod)
- [ ] Afinar instrucciones de mapeo (ingresos/consumos/retenciones/patrimonio) según casuística real

## 14) Futuras tareas (Pruebas y DX)
- [ ] Agregar runner local con ts-node para invocar directamente `api/analyze.ts` (handler(req,res)) sin levantar Vercel dev. Comando sugerido: `npm run analyze:local`.
- [ ] Endurecer el pre-resumen servidor de exógena: detectar y sumar campos concretos (ingresos, compras/consumos, retenciones, patrimonio) por nombres de columnas/hojas detectadas y enviarlos como `input_text` (no decidir, solo aportar evidencia).
- [ ] Unificar herramienta RAG también en Responses (function tools) si el SDK estabiliza soporte; hoy se inyectan extractos como texto (simple y robusto).
- [ ] Explorar conversión a PDF de exógena solo si trae beneficios reales de parseo; hoy HTML de tablas + resumen es más simple y portable.
- [ ] Mejorar logs: incluir `exogena_embed.html_length`, `exogena_summary_present`, y un `intake_report` final con validación de counts y tipos por Responses `inputItems` cuando esté disponible.
- [ ] UI: conversión HEIC→JPEG en cliente antes de subir (mejor latencia y menor costo).
- [ ] Seguridad/ops: CORS bloqueado a dominio de UI y rate‑limiting básico a `/api/analyze`.
- [ ] Capturar últimos 2 dígitos del NIT opcionalmente desde UI y mencionar la fecha límite exacta en el 'resumen' cuando esté disponible.

## 8) Integración UI
- [ ] Conectar subida de archivos con `/api/upload/init`
- [ ] Enviar payload a `/api/analyze`
- [ ] Renderizar resultado JSON + fuentes RAG (links si existen)
- [ ] Mensajería de estados: procesando, éxito, errores

## 9) QA y Endurecimiento
- [ ] Casos reales de exógena + prediales + vehículos
- [ ] Pruebas de OCR/visión con baja calidad (esperar `incertidumbres`)
- [ ] Ajuste de `RAG_TOP_K`, thresholds de similitud
- [ ] Afinar `reasoning_effort` y tamaño de prompts

## 10) Operación
- [ ] Documentación de despliegue y rotación de secretos
- [ ] Tareas de reindexación (si cambia corpus)
- [ ] Monitoreo de costos (tokens, invocaciones)
- [ ] Plan de rollback y límites de tasa

## 11) Tareas MCP (Developer DX)
- [ ] Ejecutar `backend/supabase/rag_schema.sql` desde Supabase MCP (SQL)
- [ ] Probar `match_sections` con MCP (RPC) y ajustar `threshold`/`top_k`
- [ ] Confirmar que las variables de entorno del proyecto están en Vercel y Supabase

---

Referencias rápidas:
- Ver `BACKEND_PLAN.md` para detalles, schemas y snippets.
- OpenAI: structured outputs, tools, files (openai-node helpers)
- Supabase: pgvector + RPC de búsqueda