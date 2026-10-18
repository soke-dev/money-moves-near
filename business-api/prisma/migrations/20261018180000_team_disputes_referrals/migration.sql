-- CreateEnum
CREATE TYPE "DisputeKind" AS ENUM ('CUSTOMER', 'BANK');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('NOT_RECEIVED', 'DUPLICATE', 'NOT_AS_DESCRIBED', 'UNRECOGNISED', 'UNAUTHORISED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('NEEDS_REPLY', 'UNDER_REVIEW', 'WON', 'REFUNDED', 'LOST');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referred_by_id" TEXT;

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "kind" "DisputeKind" NOT NULL,
    "reason" "DisputeReason" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'NEEDS_REPLY',
    "amount_kobo" INTEGER NOT NULL,
    "reply_by" TIMESTAMP(3) NOT NULL,
    "wait_until" TIMESTAMP(3),
    "customer_name" TEXT,
    "customer_email" TEXT,
    "outcome" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "refund_id" TEXT,
    "opened_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "document_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_business_id_idx" ON "invites"("business_id");

-- CreateIndex
CREATE INDEX "invites_email_idx" ON "invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_ref_key" ON "disputes"("ref");

-- CreateIndex
CREATE INDEX "disputes_business_id_mode_created_at_idx" ON "disputes"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "disputes_payment_id_idx" ON "disputes"("payment_id");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_referral_code_key" ON "businesses"("referral_code");

-- CreateIndex
CREATE INDEX "businesses_referred_by_id_idx" ON "businesses"("referred_by_id");

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

