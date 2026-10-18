-- A NIN the person typed, used only to open a payment account.
-- Kept off identity_claims on purpose: those keys are globally unique and
-- decide whether two accounts are the same person, so a self-declared number
-- there would let somebody squat a stranger's NIN.
ALTER TABLE "users" ADD COLUMN "declared_nin" TEXT;
ALTER TABLE "users" ADD COLUMN "declared_nin_at" TIMESTAMP(3);
