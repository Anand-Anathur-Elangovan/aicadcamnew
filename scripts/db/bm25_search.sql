-- BM25-only search function (no vector embedding required).
-- Used as a fallback when the Voyage embedding API is unavailable / rate-limited.
-- Run once in Supabase SQL editor.

CREATE OR REPLACE FUNCTION bm25_search(
  query_text        TEXT,
  match_count       INT     DEFAULT 20,
  filter_category   TEXT    DEFAULT NULL,
  filter_part_number TEXT   DEFAULT NULL
)
RETURNS TABLE (
  chunk_id    UUID,
  document_id UUID,
  content     TEXT,
  page_number INT,
  content_type TEXT,
  rrf_score   FLOAT8,
  dense_rank  INT,
  sparse_rank INT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id              AS chunk_id,
    c.document_id,
    c.content,
    c.page_number,
    c.content_type,
    -- Normalise ts_rank to a 0-1 score so callers can treat it like RRF
    ts_rank_cd(c.fts, plainto_tsquery('english', query_text), 32) AS rrf_score,
    0                 AS dense_rank,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text), 32) DESC)::INT AS sparse_rank
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE
    c.fts @@ plainto_tsquery('english', query_text)
    AND (filter_category   IS NULL OR d.category    = filter_category)
    AND (filter_part_number IS NULL OR d.part_number ILIKE '%' || filter_part_number || '%')
  ORDER BY rrf_score DESC
  LIMIT match_count;
$$;
