-- AlterTable: add bull_job_id to notification for BullMQ job tracking / future cancellation
ALTER TABLE "notification" ADD COLUMN "bull_job_id" TEXT;
