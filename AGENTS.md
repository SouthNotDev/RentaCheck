# Repository Guidelines

## Project Structure & Modules
- Root: project docs and env (`README.md`, `.env`).
- `UI/`: React + TypeScript app (Vite, Tailwind). Key areas: `src/pages/`, `src/components/ui/`, `src/layout/`, `src/context/`, `src/utils/`.
- `Research for RAG/`: corpus and tools for tax knowledge base (`output/*.json*`, `research.js`).

## Build, Test, and Development
- `cd UI && npm install`: install frontend deps.
- `npm run dev`: start Vite dev server.
- `npm run build`: production build to `UI/dist`.
- `npm run preview`: preview built app locally.
- `npm run lint`: run ESLint on `*.ts/tsx`.

## Coding Style & Naming
- Language: TypeScript, React 18; 2‑space indent; single quotes; semicolons allowed.
- Components: PascalCase files (e.g., `MainLayout.tsx`, `ProgressTimeline.tsx`).
- Hooks/utils: camelCase (e.g., `useFlow.ts`, `parseExogena.ts`).
- CSS: Tailwind utility classes in `*.tsx`; globals in `src/index.css`.
- Linting: ESLint (recommended rules, React Hooks, TypeScript). Fix issues before PRs.

## Testing Guidelines
- Current: no automated tests configured.
- Preferred stack: Vitest + React Testing Library when adding tests.
- Naming: colocate as `Component.test.tsx` or under `__tests__/`.
- Aim for coverage on pages, critical utils, and context logic.
- For testing use files on /files-for-test-only, do not ever hardcode answers tailored to this files, they should be called only for testing and never hardcoded 
## Commit & Pull Requests
- Commits: follow Conventional Commits, e.g. `feat(ui): add Reporte page chart` or `fix(rag): correct UVT parsing`.
- PRs must include:
  - Problem/solution summary and scope (UI/RAG).
  - Linked issue or task ID.
  - Screenshots/GIFs for UI changes.
  - Local verification: `npm run lint`, `npm run build` pass.

## Security & Config Tips
- Secrets: never commit `.env`. Frontend env vars must start with `VITE_` (e.g., `VITE_ENABLE_REFERENCE_LINKS=true`).
- Modes: code may branch on `import.meta.env.MODE === 'development'`; test both dev/preview.
- Data: RAG outputs in `Research for RAG/output/` can be large—avoid bundling into UI; fetch or mock in development.

## Resumen del Producto
- Nombre: Renta-check. Objetivo: decidir si una persona debe o no declarar renta en Colombia.
- Entradas: exógena (`.xlsx`), predial de inmuebles e impuesto de vehículos (imagen/PDF/u otros). Toda la data se pasa al LLM vía tools con archivos e imágenes.
- Validación: prompt estructurado + verificación final con RAG.

## Reglas de LLM y RAG
- Modelo obligatorio: GPT `gpt-5-2025-08-07`. No se aceptan fallbacks.
- Structured output: definir esquema JSON y validarlo; usar documentación vía MCP de Context7 para OpenAI API (razonamiento, tools de imágenes/archivos, structured outputs).
- Tools: siempre usar llamadas a tools para inyectar archivos/imágenes como input del modelo.
- RAG: usar exclusivamente el MCP de Supabase para indexado/búsqueda/embeddings; no implementar alternativas ad‑hoc.
- Simplicidad: mantener el código y flujos lo más simples posible.

## Logs y Observabilidad
- Servidor (Netlify/Vercel u otro): logs deben permitir debug completo.
- Registrar: conexión a la API, payloads relevantes (sin secretos), decisión del LLM, resultados/verificaciones de RAG, archivos detectados y errores.
- Objetivo: que el diagnóstico se pueda hacer solo con los logs del servidor.