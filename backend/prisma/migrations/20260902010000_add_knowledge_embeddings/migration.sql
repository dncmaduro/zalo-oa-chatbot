CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "knowledge_item_versions"
  ADD COLUMN "embedding" vector,
  ADD COLUMN "embedding_model" TEXT,
  ADD COLUMN "embedding_content_hash" TEXT,
  ADD COLUMN "embedded_at" TIMESTAMPTZ(3);

ALTER TABLE "knowledge_document_sections"
  ADD COLUMN "embedding" vector,
  ADD COLUMN "embedding_model" TEXT,
  ADD COLUMN "embedding_content_hash" TEXT,
  ADD COLUMN "embedded_at" TIMESTAMPTZ(3);
