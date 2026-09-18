CREATE TABLE "zalo_oa_token_credentials" (
  "key" TEXT NOT NULL,
  "encrypted_access_token" TEXT NOT NULL,
  "encrypted_refresh_token" TEXT NOT NULL,
  "access_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_refreshed_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "zalo_oa_token_credentials_pkey" PRIMARY KEY ("key")
);
