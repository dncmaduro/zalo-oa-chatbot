-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('MOCK', 'ZALO');

-- CreateEnum
CREATE TYPE "ChatUserType" AS ENUM ('UNKNOWN', 'CUSTOMER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "KnowledgeAudience" AS ENUM ('CUSTOMER', 'EMPLOYEE', 'OPERATOR', 'ALL');

-- CreateEnum
CREATE TYPE "ResolutionType" AS ENUM ('AUTO_RESPONSE', 'OPERATOR_TASK', 'HUMAN_CONTACT');

-- CreateEnum
CREATE TYPE "KnowledgeVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'FILE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('READY', 'NEEDS_REVIEW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('URL', 'INTERNAL_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'HUMAN_TAKEOVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('COLLECTING_INFORMATION', 'READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('USER', 'BOT', 'OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'BUTTON', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('CREATED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "OperatorRoleCode" AS ENUM ('ADMIN', 'LEADER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "OperatorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OperatorTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_MORE_INFO', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskResponseStatus" AS ENUM ('GENERATED', 'EDITED', 'APPROVED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "HumanContactStatus" AS ENUM ('PENDING', 'ASSIGNED', 'CONTACTED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('INITIAL', 'BULK_UPDATE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PARSING', 'VALIDATING', 'PREVIEW_READY', 'APPLYING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('KNOWLEDGE_ITEM', 'KNOWLEDGE_DOCUMENT', 'DOCUMENT_SECTION', 'MEDIA', 'SOURCE', 'REVIEW_ISSUE');

-- CreateEnum
CREATE TYPE "ImportOperation" AS ENUM ('CREATE', 'UPDATE', 'ARCHIVE', 'NO_CHANGE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportRecordStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'OPERATOR', 'BOT');

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "current_published_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_versions" (
    "id" UUID NOT NULL,
    "knowledge_item_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sub_category" TEXT,
    "audience" "KnowledgeAudience" NOT NULL,
    "resolution_type" "ResolutionType" NOT NULL,
    "user_scenarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "example_questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "knowledge_content" TEXT NOT NULL,
    "initial_response" TEXT,
    "required_fields" JSONB,
    "operator_task_type" TEXT,
    "operator_instruction" TEXT,
    "success_response_template" TEXT,
    "failure_response_template" TEXT,
    "acknowledgement_message" TEXT,
    "human_contact_message" TEXT,
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_item_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "current_published_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_versions" (
    "id" UUID NOT NULL,
    "knowledge_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "audience" "KnowledgeAudience" NOT NULL,
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_sections" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "section_code" TEXT NOT NULL,
    "section_title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_version_sections" (
    "knowledge_item_version_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_item_version_sections_pkey" PRIMARY KEY ("knowledge_item_version_id","section_id")
);

-- CreateTable
CREATE TABLE "knowledge_media" (
    "id" UUID NOT NULL,
    "media_code" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "cloudinary_public_id" TEXT NOT NULL,
    "cloudinary_resource_type" TEXT,
    "cloudinary_format" TEXT,
    "secure_url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" BIGINT,
    "original_filename" TEXT,
    "checksum" TEXT,
    "description" TEXT,
    "source_sheet" TEXT,
    "source_anchor" TEXT,
    "source_row" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_version_media" (
    "knowledge_item_version_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,

    CONSTRAINT "knowledge_item_version_media_pkey" PRIMARY KEY ("knowledge_item_version_id","media_id")
);

-- CreateTable
CREATE TABLE "knowledge_document_version_media" (
    "document_version_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,

    CONSTRAINT "knowledge_document_version_media_pkey" PRIMARY KEY ("document_version_id","media_id")
);

-- CreateTable
CREATE TABLE "knowledge_section_media" (
    "section_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,

    CONSTRAINT "knowledge_section_media_pkey" PRIMARY KEY ("section_id","media_id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL DEFAULT 'URL',
    "title" TEXT,
    "url" TEXT,
    "external_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_version_sources" (
    "knowledge_item_version_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "knowledge_item_version_sources_pkey" PRIMARY KEY ("knowledge_item_version_id","source_id")
);

-- CreateTable
CREATE TABLE "knowledge_document_version_sources" (
    "document_version_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "knowledge_document_version_sources_pkey" PRIMARY KEY ("document_version_id","source_id")
);

-- CreateTable
CREATE TABLE "knowledge_section_sources" (
    "section_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "knowledge_section_sources_pkey" PRIMARY KEY ("section_id","source_id")
);

-- CreateTable
CREATE TABLE "chat_users" (
    "id" UUID NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "user_type" "ChatUserType" NOT NULL DEFAULT 'UNKNOWN',
    "display_name" TEXT,
    "phone_number" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "chat_user_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "context" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_message_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_resolutions" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "trigger_message_id" UUID,
    "knowledge_item_version_id" UUID,
    "resolution_type" "ResolutionType" NOT NULL,
    "status" "ResolutionStatus" NOT NULL DEFAULT 'COLLECTING_INFORMATION',
    "required_fields" JSONB,
    "collected_fields" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversation_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "sender_type" "MessageSenderType" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "message_type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "payload" JSONB,
    "external_message_id" TEXT,
    "delivery_status" "MessageDeliveryStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_knowledge_item_refs" (
    "message_id" UUID NOT NULL,
    "knowledge_item_version_id" UUID NOT NULL,
    "retrieval_score" DOUBLE PRECISION,
    "rank" INTEGER,

    CONSTRAINT "message_knowledge_item_refs_pkey" PRIMARY KEY ("message_id","knowledge_item_version_id")
);

-- CreateTable
CREATE TABLE "message_knowledge_section_refs" (
    "message_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "retrieval_score" DOUBLE PRECISION,
    "rank" INTEGER,

    CONSTRAINT "message_knowledge_section_refs_pkey" PRIMARY KEY ("message_id","section_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "OperatorRoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "OperatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_sessions" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_tasks" (
    "id" UUID NOT NULL,
    "task_code" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "resolution_id" UUID,
    "knowledge_item_version_id" UUID,
    "task_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "input_data" JSONB NOT NULL,
    "status" "OperatorTaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "current_assignee_id" UUID,
    "result_data" JSONB,
    "result_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "operator_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_task_assignments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "assigned_by_operator_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "operator_task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "operator_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "OperatorTaskStatus",
    "to_status" "OperatorTaskStatus",
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_task_responses" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "ai_generated_text" TEXT NOT NULL,
    "final_text" TEXT,
    "status" "TaskResponseStatus" NOT NULL DEFAULT 'GENERATED',
    "approved_by_operator_id" UUID,
    "sent_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "operator_task_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_contact_requests" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "resolution_id" UUID,
    "knowledge_item_version_id" UUID,
    "full_name" TEXT,
    "phone_number" TEXT,
    "reason" TEXT NOT NULL,
    "context" JSONB,
    "status" "HumanContactStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "current_assignee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMPTZ(3),
    "contacted_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "human_contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_contact_assignments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "assigned_by_operator_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "human_contact_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "human_contact_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "operator_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "HumanContactStatus",
    "to_status" "HumanContactStatus",
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_contact_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issues" (
    "id" UUID NOT NULL,
    "issue_code" TEXT NOT NULL,
    "import_batch_id" UUID,
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "issue_type" TEXT NOT NULL,
    "original_content" TEXT,
    "detected_problem" TEXT NOT NULL,
    "suggested_action" TEXT,
    "severity" "ReviewSeverity" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "resolved_by_operator_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_items" (
    "issue_id" UUID NOT NULL,
    "knowledge_item_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_items_pkey" PRIMARY KEY ("issue_id","knowledge_item_id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_item_versions" (
    "issue_id" UUID NOT NULL,
    "knowledge_item_version_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_item_versions_pkey" PRIMARY KEY ("issue_id","knowledge_item_version_id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_documents" (
    "issue_id" UUID NOT NULL,
    "knowledge_document_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_documents_pkey" PRIMARY KEY ("issue_id","knowledge_document_id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_document_versions" (
    "issue_id" UUID NOT NULL,
    "knowledge_document_version_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_document_versions_pkey" PRIMARY KEY ("issue_id","knowledge_document_version_id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_sections" (
    "issue_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_sections_pkey" PRIMARY KEY ("issue_id","section_id")
);

-- CreateTable
CREATE TABLE "knowledge_review_issue_media" (
    "issue_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,

    CONSTRAINT "knowledge_review_issue_media_pkey" PRIMARY KEY ("issue_id","media_id")
);

-- CreateTable
CREATE TABLE "knowledge_import_batches" (
    "id" UUID NOT NULL,
    "mode" "ImportMode" NOT NULL DEFAULT 'BULK_UPDATE',
    "filename" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "schema_version" TEXT,
    "original_file_url" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "created_by_operator_id" UUID,
    "confirmed_by_operator_id" UUID,
    "knowledge_items_count" INTEGER NOT NULL DEFAULT 0,
    "documents_count" INTEGER NOT NULL DEFAULT 0,
    "sections_count" INTEGER NOT NULL DEFAULT 0,
    "media_count" INTEGER NOT NULL DEFAULT 0,
    "review_issue_count" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preview_ready_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_import_records" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "entity_key" TEXT NOT NULL,
    "proposed_operation" "ImportOperation" NOT NULL,
    "status" "ImportRecordStatus" NOT NULL DEFAULT 'PENDING',
    "source_sheet" TEXT,
    "source_row" INTEGER,
    "before_data" JSONB,
    "after_data" JSONB,
    "diff" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_import_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "operator_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_code_key" ON "knowledge_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_current_published_version_id_key" ON "knowledge_items"("current_published_version_id");

-- CreateIndex
CREATE INDEX "knowledge_item_versions_knowledge_item_id_status_idx" ON "knowledge_item_versions"("knowledge_item_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_item_versions_category_idx" ON "knowledge_item_versions"("category");

-- CreateIndex
CREATE INDEX "knowledge_item_versions_audience_idx" ON "knowledge_item_versions"("audience");

-- CreateIndex
CREATE INDEX "knowledge_item_versions_resolution_type_idx" ON "knowledge_item_versions"("resolution_type");

-- CreateIndex
CREATE INDEX "knowledge_item_versions_status_idx" ON "knowledge_item_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_item_versions_knowledge_item_id_version_number_key" ON "knowledge_item_versions"("knowledge_item_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_code_key" ON "knowledge_documents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_current_published_version_id_key" ON "knowledge_documents"("current_published_version_id");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_knowledge_document_id_status_idx" ON "knowledge_document_versions"("knowledge_document_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_category_idx" ON "knowledge_document_versions"("category");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_audience_idx" ON "knowledge_document_versions"("audience");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_status_idx" ON "knowledge_document_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_versions_knowledge_document_id_version_n_key" ON "knowledge_document_versions"("knowledge_document_id", "version_number");

-- CreateIndex
CREATE INDEX "knowledge_document_sections_document_version_id_sort_order_idx" ON "knowledge_document_sections"("document_version_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_sections_document_version_id_section_cod_key" ON "knowledge_document_sections"("document_version_id", "section_code");

-- CreateIndex
CREATE INDEX "knowledge_item_version_sections_section_id_idx" ON "knowledge_item_version_sections"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_media_media_code_key" ON "knowledge_media"("media_code");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_media_cloudinary_public_id_key" ON "knowledge_media"("cloudinary_public_id");

-- CreateIndex
CREATE INDEX "knowledge_media_status_idx" ON "knowledge_media"("status");

-- CreateIndex
CREATE INDEX "knowledge_media_checksum_idx" ON "knowledge_media"("checksum");

-- CreateIndex
CREATE INDEX "knowledge_item_version_media_media_id_idx" ON "knowledge_item_version_media"("media_id");

-- CreateIndex
CREATE INDEX "knowledge_document_version_media_media_id_idx" ON "knowledge_document_version_media"("media_id");

-- CreateIndex
CREATE INDEX "knowledge_section_media_media_id_idx" ON "knowledge_section_media"("media_id");

-- CreateIndex
CREATE INDEX "knowledge_item_version_sources_source_id_idx" ON "knowledge_item_version_sources"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_document_version_sources_source_id_idx" ON "knowledge_document_version_sources"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_section_sources_source_id_idx" ON "knowledge_section_sources"("source_id");

-- CreateIndex
CREATE INDEX "chat_users_user_type_idx" ON "chat_users"("user_type");

-- CreateIndex
CREATE INDEX "chat_users_phone_number_idx" ON "chat_users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "chat_users_channel_external_user_id_key" ON "chat_users"("channel", "external_user_id");

-- CreateIndex
CREATE INDEX "conversations_chat_user_id_status_idx" ON "conversations"("chat_user_id", "status");

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_resolutions_conversation_id_status_idx" ON "conversation_resolutions"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "conversation_resolutions_knowledge_item_version_id_idx" ON "conversation_resolutions"("knowledge_item_version_id");

-- CreateIndex
CREATE INDEX "conversation_resolutions_resolution_type_idx" ON "conversation_resolutions"("resolution_type");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_delivery_status_idx" ON "messages"("delivery_status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channel_external_message_id_key" ON "messages"("channel", "external_message_id");

-- CreateIndex
CREATE INDEX "message_knowledge_item_refs_knowledge_item_version_id_idx" ON "message_knowledge_item_refs"("knowledge_item_version_id");

-- CreateIndex
CREATE INDEX "message_knowledge_section_refs_section_id_idx" ON "message_knowledge_section_refs"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- CreateIndex
CREATE INDEX "operators_role_id_status_idx" ON "operators"("role_id", "status");

-- CreateIndex
CREATE INDEX "operator_sessions_operator_id_idx" ON "operator_sessions"("operator_id");

-- CreateIndex
CREATE INDEX "operator_sessions_expires_at_idx" ON "operator_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "operator_tasks_task_code_key" ON "operator_tasks"("task_code");

-- CreateIndex
CREATE UNIQUE INDEX "operator_tasks_resolution_id_key" ON "operator_tasks"("resolution_id");

-- CreateIndex
CREATE INDEX "operator_tasks_conversation_id_idx" ON "operator_tasks"("conversation_id");

-- CreateIndex
CREATE INDEX "operator_tasks_status_created_at_idx" ON "operator_tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "operator_tasks_current_assignee_id_status_idx" ON "operator_tasks"("current_assignee_id", "status");

-- CreateIndex
CREATE INDEX "operator_tasks_priority_status_idx" ON "operator_tasks"("priority", "status");

-- CreateIndex
CREATE INDEX "operator_tasks_task_type_idx" ON "operator_tasks"("task_type");

-- CreateIndex
CREATE INDEX "operator_task_assignments_task_id_assigned_at_idx" ON "operator_task_assignments"("task_id", "assigned_at");

-- CreateIndex
CREATE INDEX "operator_task_assignments_operator_id_idx" ON "operator_task_assignments"("operator_id");

-- CreateIndex
CREATE INDEX "operator_task_events_task_id_created_at_idx" ON "operator_task_events"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "operator_task_events_operator_id_idx" ON "operator_task_events"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "operator_task_responses_sent_message_id_key" ON "operator_task_responses"("sent_message_id");

-- CreateIndex
CREATE INDEX "operator_task_responses_task_id_status_idx" ON "operator_task_responses"("task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "human_contact_requests_resolution_id_key" ON "human_contact_requests"("resolution_id");

-- CreateIndex
CREATE INDEX "human_contact_requests_conversation_id_idx" ON "human_contact_requests"("conversation_id");

-- CreateIndex
CREATE INDEX "human_contact_requests_status_created_at_idx" ON "human_contact_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "human_contact_requests_current_assignee_id_status_idx" ON "human_contact_requests"("current_assignee_id", "status");

-- CreateIndex
CREATE INDEX "human_contact_requests_priority_status_idx" ON "human_contact_requests"("priority", "status");

-- CreateIndex
CREATE INDEX "human_contact_assignments_request_id_assigned_at_idx" ON "human_contact_assignments"("request_id", "assigned_at");

-- CreateIndex
CREATE INDEX "human_contact_assignments_operator_id_idx" ON "human_contact_assignments"("operator_id");

-- CreateIndex
CREATE INDEX "human_contact_events_request_id_created_at_idx" ON "human_contact_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "human_contact_events_operator_id_idx" ON "human_contact_events"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_review_issues_issue_code_key" ON "knowledge_review_issues"("issue_code");

-- CreateIndex
CREATE INDEX "knowledge_review_issues_status_severity_idx" ON "knowledge_review_issues"("status", "severity");

-- CreateIndex
CREATE INDEX "knowledge_review_issues_import_batch_id_idx" ON "knowledge_review_issues"("import_batch_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_items_knowledge_item_id_idx" ON "knowledge_review_issue_items"("knowledge_item_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_item_versions_knowledge_item_version_idx" ON "knowledge_review_issue_item_versions"("knowledge_item_version_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_documents_knowledge_document_id_idx" ON "knowledge_review_issue_documents"("knowledge_document_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_document_versions_knowledge_document_idx" ON "knowledge_review_issue_document_versions"("knowledge_document_version_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_sections_section_id_idx" ON "knowledge_review_issue_sections"("section_id");

-- CreateIndex
CREATE INDEX "knowledge_review_issue_media_media_id_idx" ON "knowledge_review_issue_media"("media_id");

-- CreateIndex
CREATE INDEX "knowledge_import_batches_file_hash_idx" ON "knowledge_import_batches"("file_hash");

-- CreateIndex
CREATE INDEX "knowledge_import_batches_status_created_at_idx" ON "knowledge_import_batches"("status", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_import_records_batch_id_status_idx" ON "knowledge_import_records"("batch_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_import_records_entity_type_entity_key_idx" ON "knowledge_import_records"("entity_type", "entity_key");

-- CreateIndex
CREATE INDEX "knowledge_import_records_proposed_operation_idx" ON "knowledge_import_records"("proposed_operation");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_operator_id_idx" ON "audit_logs"("operator_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_versions" ADD CONSTRAINT "knowledge_item_versions_knowledge_item_id_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_sections" ADD CONSTRAINT "knowledge_document_sections_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_sections" ADD CONSTRAINT "knowledge_item_version_sections_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_sections" ADD CONSTRAINT "knowledge_item_version_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "knowledge_document_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_media" ADD CONSTRAINT "knowledge_item_version_media_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_media" ADD CONSTRAINT "knowledge_item_version_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "knowledge_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_version_media" ADD CONSTRAINT "knowledge_document_version_media_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_version_media" ADD CONSTRAINT "knowledge_document_version_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "knowledge_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_section_media" ADD CONSTRAINT "knowledge_section_media_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "knowledge_document_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_section_media" ADD CONSTRAINT "knowledge_section_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "knowledge_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_sources" ADD CONSTRAINT "knowledge_item_version_sources_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_version_sources" ADD CONSTRAINT "knowledge_item_version_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_version_sources" ADD CONSTRAINT "knowledge_document_version_sources_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_version_sources" ADD CONSTRAINT "knowledge_document_version_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_section_sources" ADD CONSTRAINT "knowledge_section_sources_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "knowledge_document_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_section_sources" ADD CONSTRAINT "knowledge_section_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_chat_user_id_fkey" FOREIGN KEY ("chat_user_id") REFERENCES "chat_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_resolutions" ADD CONSTRAINT "conversation_resolutions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_resolutions" ADD CONSTRAINT "conversation_resolutions_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_resolutions" ADD CONSTRAINT "conversation_resolutions_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_knowledge_item_refs" ADD CONSTRAINT "message_knowledge_item_refs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_knowledge_item_refs" ADD CONSTRAINT "message_knowledge_item_refs_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_knowledge_section_refs" ADD CONSTRAINT "message_knowledge_section_refs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_knowledge_section_refs" ADD CONSTRAINT "message_knowledge_section_refs_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "knowledge_document_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "conversation_resolutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_tasks" ADD CONSTRAINT "operator_tasks_current_assignee_id_fkey" FOREIGN KEY ("current_assignee_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_assignments" ADD CONSTRAINT "operator_task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "operator_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_assignments" ADD CONSTRAINT "operator_task_assignments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_assignments" ADD CONSTRAINT "operator_task_assignments_assigned_by_operator_id_fkey" FOREIGN KEY ("assigned_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_events" ADD CONSTRAINT "operator_task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "operator_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_events" ADD CONSTRAINT "operator_task_events_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_responses" ADD CONSTRAINT "operator_task_responses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "operator_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_responses" ADD CONSTRAINT "operator_task_responses_approved_by_operator_id_fkey" FOREIGN KEY ("approved_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_task_responses" ADD CONSTRAINT "operator_task_responses_sent_message_id_fkey" FOREIGN KEY ("sent_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_requests" ADD CONSTRAINT "human_contact_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_requests" ADD CONSTRAINT "human_contact_requests_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "conversation_resolutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_requests" ADD CONSTRAINT "human_contact_requests_knowledge_item_version_id_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_requests" ADD CONSTRAINT "human_contact_requests_current_assignee_id_fkey" FOREIGN KEY ("current_assignee_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_assignments" ADD CONSTRAINT "human_contact_assignments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "human_contact_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_assignments" ADD CONSTRAINT "human_contact_assignments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_assignments" ADD CONSTRAINT "human_contact_assignments_assigned_by_operator_id_fkey" FOREIGN KEY ("assigned_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_events" ADD CONSTRAINT "human_contact_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "human_contact_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_contact_events" ADD CONSTRAINT "human_contact_events_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issues" ADD CONSTRAINT "knowledge_review_issues_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "knowledge_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issues" ADD CONSTRAINT "knowledge_review_issues_resolved_by_operator_id_fkey" FOREIGN KEY ("resolved_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_items" ADD CONSTRAINT "knowledge_review_issue_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_items" ADD CONSTRAINT "knowledge_review_issue_items_knowledge_item_id_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_item_versions" ADD CONSTRAINT "knowledge_review_issue_item_versions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_item_versions" ADD CONSTRAINT "knowledge_review_issue_item_versions_knowledge_item_versio_fkey" FOREIGN KEY ("knowledge_item_version_id") REFERENCES "knowledge_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_documents" ADD CONSTRAINT "knowledge_review_issue_documents_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_documents" ADD CONSTRAINT "knowledge_review_issue_documents_knowledge_document_id_fkey" FOREIGN KEY ("knowledge_document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_document_versions" ADD CONSTRAINT "knowledge_review_issue_document_versions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_document_versions" ADD CONSTRAINT "knowledge_review_issue_document_versions_knowledge_documen_fkey" FOREIGN KEY ("knowledge_document_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_sections" ADD CONSTRAINT "knowledge_review_issue_sections_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_sections" ADD CONSTRAINT "knowledge_review_issue_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "knowledge_document_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_media" ADD CONSTRAINT "knowledge_review_issue_media_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "knowledge_review_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_review_issue_media" ADD CONSTRAINT "knowledge_review_issue_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "knowledge_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_import_batches" ADD CONSTRAINT "knowledge_import_batches_created_by_operator_id_fkey" FOREIGN KEY ("created_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_import_batches" ADD CONSTRAINT "knowledge_import_batches_confirmed_by_operator_id_fkey" FOREIGN KEY ("confirmed_by_operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_import_records" ADD CONSTRAINT "knowledge_import_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "knowledge_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
