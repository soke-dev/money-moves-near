-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'metamap',
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "metamap_ref" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "middle_name" TEXT,
    "gender" TEXT,
    "date_of_birth" TEXT,
    "phone" TEXT,
    "photo_url" TEXT,
    "selfie_url" TEXT,
    "facematch_score" DOUBLE PRECISION,
    "facematch_passed" BOOLEAN,
    "raw_response" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_metamap_ref_key" ON "kyc_verifications"("metamap_ref");

-- CreateIndex
CREATE INDEX "kyc_verifications_user_id_idx" ON "kyc_verifications"("user_id");

-- CreateIndex
CREATE INDEX "kyc_verifications_metamap_ref_idx" ON "kyc_verifications"("metamap_ref");

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
