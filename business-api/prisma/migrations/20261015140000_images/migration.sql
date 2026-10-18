-- Logos and photos.
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "businesses" ADD COLUMN "logo_id" TEXT, ADD COLUMN "brand" JSONB;
ALTER TABLE "users" ADD COLUMN "avatar_id" TEXT;
