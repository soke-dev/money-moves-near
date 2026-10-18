-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('MNEMONIC', 'EMBEDDED');

-- AlterTable (additive, nullable — safe with running clients)
ALTER TABLE "users" ADD COLUMN "wallet_type" "WalletType";
