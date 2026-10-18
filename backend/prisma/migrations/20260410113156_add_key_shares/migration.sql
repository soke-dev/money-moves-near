-- CreateTable
CREATE TABLE "key_shares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "key_shares_user_id_key" ON "key_shares"("user_id");

-- AddForeignKey
ALTER TABLE "key_shares" ADD CONSTRAINT "key_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
