SHELL := /bin/sh

BACKEND_DIR := backend
YARN ?= yarn
COMPOSE ?= docker compose
API_URL ?= http://localhost:3000

.DEFAULT_GOAL := help
.PHONY: help install dev build lint db-up db-down db-logs db-access prisma-generate migrate migrate-new seed studio prisma-format prisma-validate kb-preview kb-clear check

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  make %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install backend dependencies
	cd $(BACKEND_DIR) && $(YARN) install

dev: ## Run the backend in watch mode
	cd $(BACKEND_DIR) && $(YARN) start:dev

build: ## Build the backend for production
	cd $(BACKEND_DIR) && $(YARN) build

lint: ## Lint and automatically fix backend source files
	cd $(BACKEND_DIR) && $(YARN) lint

db-up: ## Start PostgreSQL in Docker
	$(COMPOSE) up -d postgres

db-down: ## Stop the Docker stack
	$(COMPOSE) down

db-logs: ## Follow PostgreSQL Docker logs
	$(COMPOSE) logs -f postgres

db-access: ## Open a PostgreSQL shell in the Docker container
	$(COMPOSE) exec postgres psql -U postgres -d zalo_chatbot

prisma-generate: ## Regenerate Prisma Client
	cd $(BACKEND_DIR) && $(YARN) prisma generate

migrate: ## Apply pending Prisma migrations locally
	cd $(BACKEND_DIR) && $(YARN) prisma migrate dev

migrate-new: ## Create and apply a migration; usage: make migrate-new name=add_users
	@test -n "$(name)" || (echo "Missing migration name. Usage: make migrate-new name=add_users" >&2; exit 2)
	cd $(BACKEND_DIR) && $(YARN) prisma migrate dev --name "$(name)"

seed: ## Seed RBAC and development data
	cd $(BACKEND_DIR) && $(YARN) seed

studio: ## Open Prisma Studio
	cd $(BACKEND_DIR) && $(YARN) prisma studio

prisma-format: ## Format Prisma schema
	cd $(BACKEND_DIR) && $(YARN) prisma format

prisma-validate: ## Validate Prisma schema
	cd $(BACKEND_DIR) && $(YARN) prisma validate

kb-preview: ## POST an .xlsx preview; usage: make kb-preview file=/path/to/file.xlsx
	@test -n "$(file)" || (echo "Missing workbook path. Usage: make kb-preview file=/path/to/file.xlsx" >&2; exit 2)
	@test -f "$(file)" || (echo "Workbook not found: $(file)" >&2; exit 2)
	curl --fail-with-body --show-error --form "file=@$(file)" "$(API_URL)/knowledge-import/preview"

kb-clear: ## Clear Knowledge Base import data
	$(COMPOSE) exec postgres psql \
		-U postgres \
		-d zalo_chatbot \
		-c "TRUNCATE TABLE knowledge_import_batches, knowledge_items, knowledge_documents, knowledge_media, knowledge_review_issues, knowledge_sources RESTART IDENTITY CASCADE;"

check: prisma-validate prisma-generate build ## Validate schema, generate Prisma Client, and build
