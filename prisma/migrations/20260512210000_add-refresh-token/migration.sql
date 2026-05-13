-- AlterTable: add refresh token fields for httpOnly cookie rotation
ALTER TABLE "user"
  ADD COLUMN "refresh_token_hash" TEXT,
  ADD COLUMN "refresh_token_exp"  TIMESTAMP(3);
