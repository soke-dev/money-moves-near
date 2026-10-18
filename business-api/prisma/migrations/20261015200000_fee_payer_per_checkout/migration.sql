-- A link or an outlet can choose who pays the fee; null follows the business.
ALTER TABLE "payment_links" ADD COLUMN "fee_payer" "FeePayer";
ALTER TABLE "outlets" ADD COLUMN "fee_payer" "FeePayer";
