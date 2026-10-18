-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN     "auto_disabled_at" TIMESTAMP(3),
ADD COLUMN     "failing_since" TIMESTAMP(3),
ADD COLUMN     "warned_at" TIMESTAMP(3);

