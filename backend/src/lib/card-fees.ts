/**
 * Our own card fee: moved from the person's card account into our float when a
 * card is made, and moved back if the card then fails to appear.
 */
import { prisma } from "./prisma";
import { env } from "../config/env";
import * as nuvion from "./nuvion";

const KEY = "cards_float_detail";

/** The float as a book-transfer destination, made once and remembered. */
async function floatDetailId(): Promise<string> {
  const row = await prisma.serviceStatus.findUnique({ where: { key: KEY } });
  if (row?.value) return row.value;
  const float = await nuvion.getAccount(env.NUVION_FLOAT_ACCOUNT_ID!);
  if (!float.nuvion_ban) throw new Error("Float has no account number");
  const id = await nuvion.addBookDetail(float.nuvion_ban, "Movers Digital Technologies Ltd");
  await prisma.serviceStatus.upsert({ where: { key: KEY }, create: { key: KEY, value: id, updatedBy: "system" }, update: { value: id } });
  return id;
}

/** Takes the fee; throws if it didn't go. `ref` makes a retry safe. */
export async function chargeCardFee(fromAccountId: string, cents: number, ref: string): Promise<string> {
  const reference = `mm-card-fee-${ref}`;
  const earlier = await nuvion.findTransferByReference(reference, fromAccountId).catch(() => null);
  if (earlier?.status === "successful") return earlier.id;
  const t = await nuvion.bookTransfer({
    fromAccountId,
    paymentDetailId: await floatDetailId(),
    cents,
    reference,
    narration: "Card fee",
  });
  if (t.status !== "successful") throw new Error(`card fee transfer ${t.status}: ${t.status_reason || ""}`);
  return t.id;
}

/** Gives the fee back when no card came of it. */
export async function refundCardFee(toPaymentDetailId: string, cents: number, ref: string): Promise<void> {
  await nuvion.bookTransfer({
    paymentDetailId: toPaymentDetailId,
    cents,
    reference: `mm-card-fee-refund-${ref}`,
    narration: "Card fee returned",
  });
}
