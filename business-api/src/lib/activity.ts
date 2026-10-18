/**
 * The team's activity, in words: what each audit entry for a business means,
 * for its owner and admins to read. Our team's own entries (admin_*) aren't
 * the business's to see, and wallet entries are the owner's alone.
 */
type Detail = Record<string, unknown> | null;

const ROLE: Record<string, string> = { OWNER: "owner", ADMIN: "admin", FINANCE: "finance", DEVELOPER: "developer", SUPPORT: "support", VIEWER: "viewer" };
const CHAIN: Record<string, string> = { MOVEMENT: "Movement", ARC: "Arc", MONAD: "Monad", SOLANA: "Solana", STELLAR: "Stellar" };
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const role = (v: unknown) => ROLE[str(v)] ?? str(v).toLowerCase();

export type ActivityGroup = "team" | "money" | "collect" | "settings" | "developers" | "wallet" | "verification";

/** What happened, in a line, and which group it belongs to. Null: not shown to the business. */
export function describe(action: string, d: Detail): { text: string; group: ActivityGroup } | null {
  const x = d ?? {};
  switch (action) {
    case "business_created":
      return { text: `Opened the business`, group: "settings" };
    case "team_invited":
      return { text: `Invited ${str(x.email)} as ${role(x.role)}`, group: "team" };
    case "team_invite_cancelled":
      return { text: `Cancelled the invite to ${str(x.email)}`, group: "team" };
    case "team_joined":
      return { text: `Joined the team as ${role(x.role)}`, group: "team" };
    case "team_role_changed":
      return { text: `Changed ${str(x.email) || "a teammate"} from ${role(x.from)} to ${role(x.to)}`, group: "team" };
    case "team_removed":
      return { text: `Removed ${str(x.email) || "a teammate"} from the team`, group: "team" };
    case "team_left":
      return { text: `Left the team`, group: "team" };
    case "refund_requested":
      return { text: `Started refund ${str(x.ref)} on ${str(x.payment)}`, group: "money" };
    case "refund_cancelled":
      return { text: `Cancelled refund ${str(x.ref)}`, group: "money" };
    case "dispute_replied":
      return { text: `Replied to dispute ${str(x.ref)}${Number(x.files) ? `, with ${x.files} file${Number(x.files) === 1 ? "" : "s"}` : ""}`, group: "money" };
    case "bank_account_added":
      return { text: `Added a ${str(x.bank)} account ending ${str(x.last4)}`, group: "settings" };
    case "bank_account_default":
      return { text: `Changed the default bank account`, group: "settings" };
    case "bank_account_removed":
      return { text: `Removed a bank account`, group: "settings" };
    case "money_moves_requested":
      return { text: `Asked to link @${str(x.username)} on Money Moves`, group: "settings" };
    case "money_moves_unlinked":
      return { text: `Unlinked @${str(x.username)}`, group: "settings" };
    case "settlement_chain_changed":
      return { text: `Set crypto to settle on ${CHAIN[str(x.settleChain)] ?? str(x.settleChain)}`, group: "settings" };
    case "fee_payer_changed":
      return { text: x.payer === "CUSTOMER" ? "Set customers to pay the processing fee" : "Set the business to pay the processing fee", group: "settings" };
    case "branding_changed":
      return { text: `Changed the checkout look`, group: "settings" };
    case "logo_changed":
      return { text: `Changed the logo`, group: "settings" };
    case "logo_removed":
      return { text: `Removed the logo`, group: "settings" };
    case "details_change_requested":
      return { text: `Asked to change the business details`, group: "settings" };
    case "details_change_cancelled":
      return { text: `Cancelled a details change`, group: "settings" };
    case "link_created":
      return { text: `Made a payment link, /${str(x.slug)}`, group: "collect" };
    case "link_updated":
      return { text: `Edited a payment link`, group: "collect" };
    case "link_deleted":
      return { text: `Deleted a payment link`, group: "collect" };
    case "invoice_sent":
      return { text: `Sent invoice ${str(x.number)}`, group: "collect" };
    case "invoice_reminded":
      return { text: `Sent a reminder for invoice ${str(x.number)}`, group: "collect" };
    case "invoice_voided":
      return { text: `Voided invoice ${str(x.number)}`, group: "collect" };
    case "outlet_created":
      return { text: `Made an outlet, /o/${str(x.slug)}`, group: "collect" };
    case "outlet_updated":
      return { text: `Edited an outlet`, group: "collect" };
    case "outlet_deleted":
      return { text: `Deleted an outlet`, group: "collect" };
    case "api_key_created":
      return { text: `Made a ${str(x.mode).toLowerCase()} API key${x.name ? `, "${str(x.name)}"` : ""}`, group: "developers" };
    case "api_key_revoked":
      return { text: `Revoked a ${str(x.mode).toLowerCase()} API key`, group: "developers" };
    case "webhook_endpoint_added":
      return { text: `Added a webhook endpoint, ${str(x.url).replace(/^https:\/\//, "")}`, group: "developers" };
    case "webhook_endpoint_changed":
      return { text: `Changed a webhook endpoint`, group: "developers" };
    case "webhook_endpoint_removed":
      return { text: `Removed a webhook endpoint`, group: "developers" };
    case "webhook_secret_rolled":
      return { text: `Rolled the ${str(x.mode).toLowerCase()} webhook signing secret`, group: "developers" };
    case "document_uploaded":
      return { text: `Uploaded a verification document`, group: "verification" };
    case "document_removed":
      return { text: `Removed a verification document`, group: "verification" };
    case "identity_started":
      return { text: `Started the identity check`, group: "verification" };
    case "application_submitted":
      return { text: `Sent the business for review`, group: "verification" };
    case "request_answered":
      return { text: `Answered a request from our review team`, group: "verification" };
    case "wallet_created":
      return { text: `Created the business wallet`, group: "wallet" };
    case "wallet_send":
      return { text: `Sent ${Number(x.amountUsdc ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC from the wallet${x.kind === "BANK" ? " to a bank account" : ""}`, group: "wallet" };
    case "wallet_pin_changed":
      return { text: `Changed the wallet's transfer PIN`, group: "wallet" };
    case "wallet_pin_reset":
      return { text: `Reset the wallet's transfer PIN`, group: "wallet" };
    case "wallet_exported":
      return { text: `Exported the wallet's keys`, group: "wallet" };
    case "wallet_stellar_opened":
      return { text: `Opened Stellar on the wallet`, group: "wallet" };
    default:
      return null;
  }
}
