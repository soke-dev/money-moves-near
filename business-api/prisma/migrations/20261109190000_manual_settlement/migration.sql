-- Our team settles this business by hand.
ALTER TABLE "businesses" ADD COLUMN "manual_settlement" BOOLEAN NOT NULL DEFAULT false;
