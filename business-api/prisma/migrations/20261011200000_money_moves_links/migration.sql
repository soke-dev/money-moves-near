-- Money Moves accounts a business is paid to: asked for by username, linked only when the owner approves in the app.
CREATE TYPE "MoneyMovesLinkStatus" AS ENUM ('PENDING', 'LINKED', 'DECLINED', 'EXPIRED', 'UNLINKED');

CREATE TABLE "money_moves_links" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "app_link_id" TEXT NOT NULL,
    "app_account_id" TEXT,
    "status" "MoneyMovesLinkStatus" NOT NULL DEFAULT 'PENDING',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "requested_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),
    CONSTRAINT "money_moves_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "money_moves_links_app_link_id_key" ON "money_moves_links"("app_link_id");
CREATE INDEX "money_moves_links_business_id_idx" ON "money_moves_links"("business_id");
CREATE INDEX "money_moves_links_status_idx" ON "money_moves_links"("status");

ALTER TABLE "money_moves_links" ADD CONSTRAINT "money_moves_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Like every record a business has: ended, never deleted.
CREATE TRIGGER keep_rows BEFORE DELETE ON "money_moves_links" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "money_moves_links" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
