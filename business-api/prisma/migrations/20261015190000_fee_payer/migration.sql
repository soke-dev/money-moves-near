-- Who pays the processing fee, and the fee a customer paid on top.
CREATE TYPE "FeePayer" AS ENUM ('BUSINESS', 'CUSTOMER');
ALTER TABLE "businesses" ADD COLUMN "fee_payer" "FeePayer" NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "payments" ADD COLUMN "customer_fee_kobo" INTEGER;
