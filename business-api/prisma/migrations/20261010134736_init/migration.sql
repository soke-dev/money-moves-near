-- CreateEnum
CREATE TYPE "TwoStep" AS ENUM ('EMAIL', 'APP');

-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('VERIFY_EMAIL', 'SIGN_IN', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "SettleChain" AS ENUM ('MOVEMENT', 'ARC', 'MONAD');

-- CreateEnum
CREATE TYPE "BusinessKind" AS ENUM ('REGISTERED', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('UNVERIFIED', 'IN_REVIEW', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'SUPPORT', 'VIEWER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "google_sub" TEXT,
    "two_step" "TwoStep" NOT NULL DEFAULT 'EMAIL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "method" TEXT NOT NULL DEFAULT 'password',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BusinessKind" NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "status" "BusinessStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "country" TEXT NOT NULL DEFAULT 'NG',
    "settle_chain" "SettleChain" NOT NULL DEFAULT 'MOVEMENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "business_id" TEXT,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_codes_user_id_purpose_idx" ON "login_codes"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_merchant_id_key" ON "businesses"("merchant_id");

-- CreateIndex
CREATE INDEX "members_user_id_idx" ON "members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_business_id_user_id_key" ON "members"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_log_business_id_created_at_idx" ON "audit_log"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
