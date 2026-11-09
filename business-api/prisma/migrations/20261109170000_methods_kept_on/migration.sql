-- Ways to pay our team keeps on for one business while they're off for everyone.
ALTER TABLE "businesses" ADD COLUMN "methods_kept_on" "PayMethod"[] NOT NULL DEFAULT ARRAY[]::"PayMethod"[];
