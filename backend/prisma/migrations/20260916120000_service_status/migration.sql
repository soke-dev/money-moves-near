-- CreateTable
CREATE TABLE "service_status" (
    "key" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "message" TEXT,
    "back_by" TIMESTAMP(3),
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_status_pkey" PRIMARY KEY ("key")
);
