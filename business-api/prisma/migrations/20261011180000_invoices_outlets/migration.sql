-- Invoices and outlets: two more ways to be paid. Like everything a business owns, kept for good.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "invoice_id" TEXT,
ADD COLUMN     "outlet_id" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "number" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "items" JSONB NOT NULL,
    "note" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "methods" "PayMethod"[],
    "destination" "Destination" NOT NULL,
    "bank_account_id" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "due_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "viewed_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "methods" "PayMethod"[],
    "destination" "Destination" NOT NULL,
    "bank_account_id" TEXT,
    "staff_email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_token_key" ON "invoices"("token");

-- CreateIndex
CREATE INDEX "invoices_business_id_mode_status_idx" ON "invoices"("business_id", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_mode_number_key" ON "invoices"("business_id", "mode", "number");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_slug_key" ON "outlets"("slug");

-- CreateIndex
CREATE INDEX "outlets_business_id_mode_idx" ON "outlets"("business_id", "mode");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_outlet_id_idx" ON "payments"("outlet_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Never deleted (the function is from 20261011160000_keep_everything).
CREATE TRIGGER keep_rows BEFORE DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "invoices" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "outlets" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "outlets" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
