/*
  Warnings:

  - The values [WALLET_EXPORT] on the enum `VerificationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- DropForeignKey
ALTER TABLE "key_shares" DROP CONSTRAINT IF EXISTS "key_shares_user_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "key_shares";

-- AlterEnum
BEGIN;
CREATE TYPE "VerificationType_new" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'PIN_RESET', 'PHONE_VERIFY', 'PHONE_CHANGE');
ALTER TABLE "verification_codes" ALTER COLUMN "type" TYPE "VerificationType_new" USING ("type"::text::"VerificationType_new");
ALTER TYPE "VerificationType" RENAME TO "VerificationType_old";
ALTER TYPE "VerificationType_new" RENAME TO "VerificationType";
DROP TYPE "public"."VerificationType_old";
COMMIT;
