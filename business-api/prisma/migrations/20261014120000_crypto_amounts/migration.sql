-- Live crypto: the exact amount a payment expects, unique per address.
ALTER TABLE "payments" ADD COLUMN "crypto_micros" BIGINT;
CREATE INDEX "payments_crypto_match_idx" ON "payments"("network", "coin", "crypto_micros") WHERE "status" = 'OPEN';
