-- Ids the live bank rail issues once: customers, payout recipients and the sender.
CREATE TABLE "rail_records" (
    "provider" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rail_records_pkey" PRIMARY KEY ("provider","key")
);
