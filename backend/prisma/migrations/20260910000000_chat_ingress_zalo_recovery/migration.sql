ALTER TABLE "zalo_webhook_events" ADD COLUMN "processing_started_at" TIMESTAMPTZ(3);
CREATE TABLE "chat_ingresses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "source" TEXT NOT NULL, "idempotency_key" TEXT NOT NULL,
  "conversation_id" UUID, "inbound_message_id" UUID, "outbound_message_id" UUID, "result" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "chat_ingresses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_ingresses_source_idempotency_key_key" ON "chat_ingresses"("source", "idempotency_key");
CREATE INDEX "chat_ingresses_inbound_message_id_idx" ON "chat_ingresses"("inbound_message_id");
