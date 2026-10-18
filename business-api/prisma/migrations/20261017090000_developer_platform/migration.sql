-- AlterTable
ALTER TABLE "payment_links" ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "customer_name" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_settings" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "secret" BYTEA NOT NULL,
    "retries" BOOLEAN NOT NULL DEFAULT true,
    "rolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enforce_ips" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "developer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_at" TIMESTAMP(3),
    "response_code" INTEGER,
    "response_body" TEXT,
    "duration_ms" INTEGER,
    "error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "mode" "Mode" NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "idempotency_key" TEXT,
    "request_body" JSONB,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" INTEGER,
    "body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_allowed_ips" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "ip" TEXT NOT NULL,
    "label" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "api_allowed_ips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_business_id_mode_idx" ON "webhook_endpoints"("business_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "developer_settings_business_id_mode_key" ON "developer_settings"("business_id", "mode");

-- CreateIndex
CREATE INDEX "webhook_events_business_id_mode_created_at_idx" ON "webhook_events"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_at_idx" ON "webhook_deliveries"("status", "next_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_event_id_idx" ON "webhook_deliveries"("event_id");

-- CreateIndex
CREATE INDEX "api_requests_business_id_mode_created_at_idx" ON "api_requests"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_api_key_id_key_key" ON "idempotency_records"("api_key_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "api_allowed_ips_business_id_mode_ip_key" ON "api_allowed_ips"("business_id", "mode", "ip");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

