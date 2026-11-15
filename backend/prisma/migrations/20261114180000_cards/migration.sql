-- USD cards through Nuvion: one account per person, their cards, and top ups.
CREATE TYPE "CardKind" AS ENUM ('VIRTUAL', 'DISPOSABLE');
CREATE TYPE "CardTopupStatus" AS ENUM ('PENDING', 'PROCESSING', 'CREDITED', 'FAILED');

CREATE TABLE "card_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nuvion_account_id" TEXT NOT NULL,
    "nuvion_ban" TEXT NOT NULL,
    "payment_detail_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "card_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "card_accounts_user_id_key" ON "card_accounts"("user_id");
CREATE UNIQUE INDEX "card_accounts_nuvion_account_id_key" ON "card_accounts"("nuvion_account_id");

CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nuvion_card_id" TEXT NOT NULL,
    "kind" "CardKind" NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cards_nuvion_card_id_key" ON "cards"("nuvion_card_id");
CREATE INDEX "cards_user_id_idx" ON "cards"("user_id");

CREATE TABLE "card_topups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "credit_cents" INTEGER NOT NULL,
    "status" "CardTopupStatus" NOT NULL DEFAULT 'PENDING',
    "nuvion_transfer_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "card_topups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "card_topups_transaction_id_key" ON "card_topups"("transaction_id");
CREATE INDEX "card_topups_user_id_idx" ON "card_topups"("user_id");
CREATE INDEX "card_topups_status_idx" ON "card_topups"("status");
