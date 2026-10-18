-- Businesses on Money Moves Business asking to be paid into a person's account; nothing links until they approve.
CREATE TABLE "business_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    CONSTRAINT "business_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_links_user_id_status_idx" ON "business_links"("user_id", "status");
CREATE INDEX "business_links_business_id_idx" ON "business_links"("business_id");

ALTER TABLE "business_links" ADD CONSTRAINT "business_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
