-- An invoice can choose who pays the fee; null follows the business.
ALTER TABLE "invoices" ADD COLUMN "fee_payer" "FeePayer";
