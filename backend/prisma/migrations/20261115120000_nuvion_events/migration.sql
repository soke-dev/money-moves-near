-- Nuvion webhook events already handled.
CREATE TABLE "nuvion_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nuvion_events_pkey" PRIMARY KEY ("id")
);
