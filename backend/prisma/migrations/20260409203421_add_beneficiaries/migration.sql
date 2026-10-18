-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_code" TEXT,
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "beneficiaries_user_id_idx" ON "beneficiaries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_user_id_account_number_bank_name_key" ON "beneficiaries"("user_id", "account_number", "bank_name");

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
