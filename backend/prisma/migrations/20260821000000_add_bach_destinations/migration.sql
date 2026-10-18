-- CreateTable
CREATE TABLE "bach_destinations" (
    "id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "dest_id" TEXT NOT NULL,
    "account_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bach_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bach_destinations_bank_code_account_number_key" ON "bach_destinations"("bank_code", "account_number");
