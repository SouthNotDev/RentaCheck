RentaCheck — Guía de Desarrollo (UI + Backend)

Resumen del Producto
- Renta-check decide si una persona debe declarar renta en Colombia.
- Entradas: archivo de exógena (.xlsx) y, opcionalmente, recibos predial/vehicular (imágenes/PDF).
- Validación: modelo GPT con salida estructurada y verificación final con RAG (Supabase).

Estructura del proyecto
- `UI/`: App React + TypeScript (Vite, Tailwind/Antd). Páginas principales: Adjuntar, Cuestionario, Reporte.
- `api/`: Funciones serverless para Vercel y servidor local Express.
- `backend/`: utilidades (RAG, OpenAI, validación) y scripts.
- `Research for RAG/`: corpus y herramientas para indexación.

Requisitos
- Node.js 18+.
- Variables en `.env` y `.env.local` en el root (no commitear secretos):
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPLOADS_BUCKET=uploads`, `SIGNED_URL_EXPIRES=3600`.
  - `CORS_ALLOWED_ORIGINS=*` (en dev; restringir en prod).
  - Para modelo real (desactivado por defecto): `OPENAI_API_KEY`, `ANALYZE_MODEL=gpt-5-2025-08-07`, `ENABLE_OPENAI=true`.
  - RAG (si activas modelo real): `RAG_EMBEDDING_MODEL=text-embedding-3-small`, `RAG_TOP_K=8`, `RAG_THRESHOLD=0.6`.

Levantar en local (modo prueba)
1) Backend Express en 3000:
   - `npm run dev`
   - Rutas usadas por la UI: `/api/upload/init` (firmado), PUT a signed URL, `/api/analyze` (stub por defecto).
2) UI (Vite) en 5173:
   - `cd UI && npm install && npm run dev`
   - Opcional: exporta `VITE_API_BASE=http://127.0.0.1:3000` si cambias el puerto.

Flujo UI↔Backend (local)
- Adjuntar: el usuario elige `.xlsx/.xls/.csv/.txt` (sólo se usa `.xlsx` para el análisis real; los otros se permitirán para flexibilidad inicial).
- Cuestionario: puede agregar recibos predial/vehicular (ahora acepta `.png/.jpg/.jpeg/.heic`).
- Reporte: la UI sube exógena y recibos a Supabase Storage vía `/api/upload/init`+PUT, luego llama `/api/analyze` con `storage_path`.
- El backend (stub) responde un JSON de decisión; la UI lo normaliza al esquema de presentación.

Endpoints
- `GET /api/health`: chequeo básico.
- `POST /api/upload/init`: firma subidas; acepta `.xlsx,.xls,.csv,.txt,.pdf,.jpg,.jpeg,.png,.heic`.
- `POST /api/upload/sign-read`: URLs firmadas de lectura (backend completo).
- `POST /api/analyze`: análisis; en local usa stub (`api/analyze.js`). En Vercel, `api/analyze.ts` (modelo/RAG) con validación JSON.
- `POST /api/rag/search` y `/api/rag/index`: utilidades RAG (modelo real).
- `POST /api/pay/mp-preference`: crea Preference de Checkout Pro (Mercado Pago) y devuelve `init_point`.
 - `POST /api/pay/mp-webhook`: webhook receptor de Mercado Pago (IPN). Loguea cada notificación con `correlationId`.

Notas del backend
- En local, `server.js` enruta a los handlers de `api/` y aplica CORS.
- Para producción (Vercel), usar `api/*.ts` y setear `ENABLE_OPENAI=true` cuando estén listas las variables y RAG indexado.

Pagos (Mercado Pago — Checkout Pro)
- UI controla el modo de pago vía `VITE_PAYMENT_MODE`:
  - `test`: salta el pago y continúa el flujo.
  - `live`: llama a `/api/pay/mp-preference` y redirige a `init_point`.
- Variables backend requeridas (live):
  - `MP_ACCESS_TOKEN` (server, secreto).
  - Opcionales: `PAYMENT_PRICE_COP`, `PAYMENT_TITLE`, `PAYMENT_CURRENCY_ID=COP`, `MP_WEBHOOK_URL`.
  - Configura `MP_WEBHOOK_URL` a `https://<tu-dominio>/api/pay/mp-webhook` para recibir notificaciones.
- Variables UI (opcionales):
  - `VITE_PAYMENT_PRICE_COP` (precio mostrado), `VITE_API_BASE`.
- Preferencias usan `back_urls` con `success=${origin}/adjuntar?payment=success` (la UI ya interpreta este parámetro para marcar pago realizado).

RAG (opcional para dev rápido)
- Esquema SQL: `backend/supabase/rag_schema.sql`.
- Ingesta: `node backend/scripts/ingest-rag.js` (requiere OpenAI + Supabase). Ver `backend/README.md` para detalles.

Prueba end‑to‑end rápida (script)
- `node backend/scripts/dev-test-analyze.js http://127.0.0.1:3000`
- Realiza health, firma 3 archivos de `files-for-test-only`, sube a Storage y llama `/api/analyze`.

Consejos
- HEIC: el backend puede intentar convertir a JPEG en el flujo completo (Vercel). En local, la UI ahora permite subir HEIC; dependiendo del stub/conversión, puede usarse el original. Para mejor compatibilidad, usa JPG/PNG.
- Observabilidad: el backend completo loguea `correlationId` y eventos clave. En tests locales con stub, verás logs de subida/decisión en consola del servidor.