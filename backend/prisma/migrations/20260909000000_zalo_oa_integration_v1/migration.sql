CREATE TYPE "ZaloWebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "ZaloOutboundDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "zalo_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "external_event_key" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "external_message_id" TEXT,
  "external_user_id" TEXT,
  "oa_id" TEXT,
  "payload" JSONB NOT NULL,
  "status" "ZaloWebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "outbound_message_id" UUID,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "zalo_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "zalo_webhook_events_external_event_key_key" ON "zalo_webhook_events"("external_event_key");
CREATE INDEX "zalo_webhook_events_status_received_at_idx" ON "zalo_webhook_events"("status", "received_at");

CREATE TABLE "zalo_outbound_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "external_recipient_id" TEXT NOT NULL,
  "status" "ZaloOutboundDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "external_message_id" TEXT,
  "last_error" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "zalo_outbound_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zalo_outbound_deliveries_message_id_key" UNIQUE ("message_id"),
  CONSTRAINT "zalo_outbound_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "zalo_outbound_deliveries_status_created_at_idx" ON "zalo_outbound_deliveries"("status", "created_at");
