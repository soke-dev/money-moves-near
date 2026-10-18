-- How a claim was made, so the code can be withheld from the ones that
-- scanned it. Additive, with a default, so existing rows need no backfill:
-- every claim before this was typed or is old enough not to matter.

ALTER TABLE "voucher_claims"
  ADD COLUMN "via_scan" BOOLEAN NOT NULL DEFAULT false;
