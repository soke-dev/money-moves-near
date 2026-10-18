-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "verdict" TEXT,
    "verdict_note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_checks" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'didit',
    "session_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "status" "IdentityStatus" NOT NULL DEFAULT 'PENDING',
    "first_name" TEXT,
    "last_name" TEXT,
    "date_of_birth" TEXT,
    "document_last4" TEXT,
    "warnings" JSONB,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_business_id_key" ON "applications"("business_id");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "documents_business_id_kind_idx" ON "documents"("business_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "identity_checks_session_id_key" ON "identity_checks"("session_id");

-- CreateIndex
CREATE INDEX "identity_checks_business_id_idx" ON "identity_checks"("business_id");

-- CreateIndex
CREATE INDEX "identity_checks_status_idx" ON "identity_checks"("status");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
