-- Store avatar and KYC document images directly in the database (base64 data URIs)
ALTER TABLE "users" ADD COLUMN "avatar_data" TEXT;
ALTER TABLE "kyc_verifications" ADD COLUMN "front_image" TEXT;
ALTER TABLE "kyc_verifications" ADD COLUMN "back_image" TEXT;
