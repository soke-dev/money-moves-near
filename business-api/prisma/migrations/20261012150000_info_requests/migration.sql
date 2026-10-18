-- CreateEnum
CREATE TYPE "InfoRequestKind" AS ENUM ('TEXT', 'FILE', 'BVN');

-- CreateEnum
CREATE TYPE "InfoRequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "info_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" "InfoRequestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" "InfoRequestStatus" NOT NULL DEFAULT 'OPEN',
    "asked_by" TEXT NOT NULL,
    "answer_text" TEXT,
    "answer_sealed" BYTEA,
    "answer_hint" TEXT,
    "document_id" TEXT,
    "answered_by" TEXT,
    "answered_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "info_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "info_requests_business_id_status_idx" ON "info_requests"("business_id", "status");

-- AddForeignKey
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Like every record a business has: never deleted.
CREATE TRIGGER keep_rows BEFORE DELETE ON "info_requests" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "info_requests" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
