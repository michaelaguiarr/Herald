-- AlterTable: add connected_at to channel (warmup tracking)
ALTER TABLE "channel" ADD COLUMN "connected_at" TIMESTAMP(3);

-- AlterTable: add api_key to organization (X-Api-Key auth)
ALTER TABLE "organization" ADD COLUMN "api_key" TEXT;

-- CreateIndex: unique constraint on api_key
CREATE UNIQUE INDEX "organization_api_key_key" ON "organization"("api_key");
