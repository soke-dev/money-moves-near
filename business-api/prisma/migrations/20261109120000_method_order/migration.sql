-- The order a business's ways to pay appear in at checkout.
ALTER TABLE "businesses" ADD COLUMN "method_order" "PayMethod"[] NOT NULL DEFAULT ARRAY[]::"PayMethod"[];
