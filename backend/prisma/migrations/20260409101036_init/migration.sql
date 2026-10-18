-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'PIN_RESET', 'PHONE_VERIFY');

-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('USDC', 'USDT');

-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('MOVE', 'BASE', 'SOL', 'BEP20');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'BUY', 'SELL', 'TRANSFER', 'AIRTIME', 'TV', 'LOCK', 'UNLOCK');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LockStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "bio_enabled" BOOLEAN NOT NULL DEFAULT false,
    "first_name" TEXT,
    "last_name" TEXT,
    "avatar_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NONE',
    "kyc_provider" TEXT,
    "kyc_reference" TEXT,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "login_locked_until" TIMESTAMP(3),
    "failed_pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_info" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_info" TEXT,
    "ip_address" TEXT,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "chain" "Chain" NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "asset" "Asset" NOT NULL,
    "chain" "Chain",
    "amount" DECIMAL(20,8) NOT NULL,
    "fee" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_locks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "chain" "Chain" NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "status" "LockStatus" NOT NULL DEFAULT 'ACTIVE',
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlocks_at" TIMESTAMP(3) NOT NULL,
    "unlocked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tx_alerts" BOOLEAN NOT NULL DEFAULT true,
    "price_alerts" BOOLEAN NOT NULL DEFAULT false,
    "promo_alerts" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_codes_user_id_type_idx" ON "verification_codes"("user_id", "type");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_asset_chain_key" ON "wallets"("user_id", "asset", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_type_idx" ON "transactions"("user_id", "type");

-- CreateIndex
CREATE INDEX "transactions_reference_idx" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "savings_locks_user_id_idx" ON "savings_locks"("user_id");

-- CreateIndex
CREATE INDEX "savings_locks_user_id_status_idx" ON "savings_locks"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_user_id_key" ON "notification_prefs"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_locks" ADD CONSTRAINT "savings_locks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
