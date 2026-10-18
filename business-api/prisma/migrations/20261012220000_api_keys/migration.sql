-- AlterTable
ALTER TABLE "payment_links" ADD COLUMN     "api_key_id" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_by_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");

-- CreateIndex
CREATE INDEX "api_keys_business_id_mode_idx" ON "api_keys"("business_id", "mode");

-- CreateIndex
CREATE INDEX "payment_links_api_key_id_idx" ON "payment_links"("api_key_id");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Like every record a business has: never deleted.
CREATE TRIGGER keep_rows BEFORE DELETE ON "api_keys" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "api_keys" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
