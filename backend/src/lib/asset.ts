/**
 * User-facing label for an asset symbol. Native USDC on Movement is stored
 * internally under the "USDCx" key (DB, on-chain, API), but is always shown
 * to users as plain "USDC" — in notifications, emails and receipts.
 */
export function assetLabel(asset: string): string {
  return asset === "USDCx" ? "USDC" : asset;
}
