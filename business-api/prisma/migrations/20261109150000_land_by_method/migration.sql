-- Where each way to pay lands, chosen by the business.
ALTER TABLE "businesses" ADD COLUMN "land_by" JSONB;
