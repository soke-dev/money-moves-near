-- People waiting for the business product.
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'business',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- The unique index is the feature, not an optimisation: it is what lets a
-- second attempt be answered with "already on the list" rather than silently
-- adding a duplicate.
CREATE UNIQUE INDEX "waitlist_entries_email_key" ON "waitlist_entries"("email");
