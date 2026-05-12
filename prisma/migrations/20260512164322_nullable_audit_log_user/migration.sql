-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey";

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
