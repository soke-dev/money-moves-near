-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_created_at_idx" ON "broadcasts"("created_at" DESC);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "broadcast_id" TEXT;

-- CreateIndex
CREATE INDEX "notifications_broadcast_id_idx" ON "notifications"("broadcast_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
