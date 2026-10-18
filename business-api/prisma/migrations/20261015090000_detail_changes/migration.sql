-- A live business asking to change its name, phone or support contacts; nothing changes until our team approves.
CREATE TYPE "DetailChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

CREATE TABLE "detail_changes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "status" "DetailChangeStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "detail_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "detail_changes_business_id_status_idx" ON "detail_changes"("business_id", "status");
CREATE INDEX "detail_changes_status_idx" ON "detail_changes"("status");

-- Like everything a business owns: kept for good, never removed from under it.
ALTER TABLE "detail_changes" ADD CONSTRAINT "detail_changes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
