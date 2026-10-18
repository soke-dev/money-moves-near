-- Wallet addresses the user has sent to, one row per address per chain.
-- Recent and Favourites read the same rows two ways: recency from
-- "last_used_at", which every completed withdrawal touches, and "favourite"
-- for the ones deliberately kept.
CREATE TABLE "crypto_contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "label" TEXT,
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_contacts_pkey" PRIMARY KEY ("id")
);

-- The same address on two chains is two different destinations, so the
-- uniqueness is over the pair rather than the address alone.
CREATE UNIQUE INDEX "crypto_contacts_user_id_address_chain_key"
    ON "crypto_contacts"("user_id", "address", "chain");

CREATE INDEX "crypto_contacts_user_id_idx" ON "crypto_contacts"("user_id");

ALTER TABLE "crypto_contacts" ADD CONSTRAINT "crypto_contacts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
