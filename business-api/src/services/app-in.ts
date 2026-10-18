/**
 * Live payments by the Money Moves app.
 *
 * The payment is opened on the app's side as soon as the customer picks the
 * app: it carries the price in dollars and our treasury address on each chain
 * the app can send from. The customer scans the checkout's QR, or taps its
 * link on the phone it's on, and the payment opens in the app. They
 * approve it there and send USDC or USDT from their own wallet; the app holds
 * that send to exactly this amount and our address, and tells us once it's on
 * chain. The worker reads that and the payment is paid like any other.
 */
import type { Payment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { openAppPayment, treasuryAddresses } from "../lib/app-pay";
import { publicImageUrl } from "../lib/images";
import { admit, newPayment, type Checkout, type OpenInput } from "./payments";

/** The app's side lapses a little before ours, so nothing can be paid there after we've closed. */
const APP_EARLY_MS = 2 * 60_000;

const ngn = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function openLiveAppPayment(c: Checkout, input: OpenInput, title?: string | null): Promise<Payment> {
  const price = await admit(c, "APP", input);
  const addresses = treasuryAddresses();
  if (!Object.keys(addresses).length) throw new HttpError(503, "Paying with the Money Moves app isn't switched on yet. Try another way to pay.", "app_off");
  const payment = await newPayment(c, input, "APP", price);
  try {
    const app = await openAppPayment({
      businessId: c.business.id,
      businessName: c.business.name,
      businessLogo: publicImageUrl(c.business.logoId),
      paymentRef: payment.ref,
      title: title?.slice(0, 160) || undefined,
      amount: (price.amountCents / 100).toFixed(2),
      priceLabel: c.currency === "NGN" ? ngn(price.amountKobo) : undefined,
      addresses,
      expiresAt: new Date(payment.expiresAt.getTime() - APP_EARLY_MS).toISOString(),
    });
    return await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: app.id, appCode: app.code } });
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    throw e;
  }
}
