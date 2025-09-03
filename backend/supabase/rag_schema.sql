-- RentaCheck RAG Schema (Supabase / Postgres + pgvector)
-- Creates extension, table, index, and RPC for semantic search.

-- 1) Extension: pgvector (use extensions schema when available)
create extension if not exists vector with schema extensions;

-- 2) Table: public.document_sections
create table if not exists public.document_sections (
  id bigint primary key generated always as identity,
  source text not null,
  chunk_index int not null,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(1536)
);

-- 3) HNSW index for cosine similarity on halfvec
create index if not exists document_sections_embedding_hnsw
  on public.document_sections using hnsw (embedding vector_cosine_ops);

-- 3b) Idempotency key for upserts: (source, chunk_index)
create unique index if not exists document_sections_source_chunk_idx
  on public.document_sections (source, chunk_index);

-- 4) RPC: match_sections
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