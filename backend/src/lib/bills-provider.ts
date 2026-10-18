import { getEffectiveChoice } from "./service-status";
import {
  isFlwBillsConfigured,
  flwDataPlans,
  flwElectricityItem,
  flwValidateCustomer,
  flwPayBill,
  flwFindByReference,
  mapFlwBillStatus,
  flwSupportsDisco,
  flwCablePackages,
  flwCableItem,
  FLW_AIRTIME,
} from "./flw-bills";
import {
  getDataVariations,
  verifyMeter,
  purchaseAirtime,
  purchaseData,
  purchaseElectricity,
  verifyBettingAccount,
  fundBettingAccount,
  requeryOrder,
} from "./vtu";

/**
 * One bills provider at a time, chosen from the console.
 *
 * The same shape as the payout switch and for the same reason: two rails that
 * can both fire on one transaction is how somebody gets charged twice. Not a
 * fallback chain - the selected one works and the other does not.
 *
 * ── The rule ───────────────────────────────────────────────────────────
 *
 * The provider is decided ONCE, at prepare, and stamped on the transaction.
 * Every later read - the status poll, the retry, an admin re-check - uses the
 * stamp rather than asking the switch again. So flipping only affects bills
 * that have not started, and anything in flight finishes where it began.
 *
 * That matters more here than for payouts, because the two providers do not
 * even sell the same things. A data plan is identified by an id minted by one
 * of them; handing Flutterwave a vtu.ng variation id buys nothing at best and
 * the wrong bundle at worst. A plan chosen under one provider can only be
 * fulfilled by that provider, and the stamp is what guarantees it.
 */

export type BillsProvider = "flutterwave" | "vtu";

export function isBillsProvider(v: unknown): v is BillsProvider {
  return v === "flutterwave" || v === "vtu";
}

export const BILLS_LABELS: Record<BillsProvider, string> = {
  flutterwave: "Flutterwave",
  vtu: "VTU.ng",
};

export function billsConfigured(p: BillsProvider): boolean {
  // vtu.ng needs no key we can check from here; it is the incumbent and
  // always available.
  return p === "flutterwave" ? isFlwBillsConfigured() : true;
}

/**
 * Flutterwave cannot vend data on this account, as of 2026-09-17.
 *
 * Kept as a note rather than a rule, because it is now a choice somebody makes
 * in the console rather than something this file decides for them. Probed
 * against the live API: at ₦11 it names the price it wants and that price
 * matches the catalogue for MTN (₦100), Airtel (₦75) and Glo (₦200) - and at
 * exactly that amount all three still return "Transaction Failed". They pass
 * amount validation and fail at the vend, from Flutterwave's own dashboard as
 * well as from here. 9mobile is separately wrong: listed at ₦200, demanded
 * ₦500. Airtime on the same account and key works.
 *
 * scripts/flw-data-probe.ts re-runs the check.
 */

/**
 * The provider for a given bill.
 *
 * `type` is optional only so callers that just want the console's answer -
 * the data-plan list, the meter check - can ask without one. Anything that
 * spends money passes it.
 */
export async function activeBillsProvider(type?: string): Promise<BillsProvider> {
  /**
   * Betting is vtu.ng's alone, so the switch does not get a say.
   *
   * Asking it would let the console stamp "flutterwave" on a betting bill
   * that Flutterwave cannot fulfil - and because the stamp is read rather
   * than re-derived at submit, that bill would take the crypto and then fail
   * at the vend with no rail to fall back to.
   */
  if (type === "betting") return "vtu";

  // Data has its own switch. It is the one service where the two providers
  // genuinely differ in whether they work at all, so it is chosen separately
  // rather than inferred from the others.
  const key = type === "data" ? "dataProvider" : "bills";
  const chosen = await getEffectiveChoice(key);
  return isBillsProvider(chosen) && billsConfigured(chosen) ? chosen : "vtu";
}

/**
 * Which provider a bill actually went out on.
 *
 * Anything written before this existed has no stamp and is vtu.ng by
 * definition, because vtu.ng was the only provider.
 */
export function billsProviderOf(meta: any): BillsProvider {
  const stamped = meta?.billsProvider;
  return isBillsProvider(stamped) ? stamped : "vtu";
}

// ─── Plans ────────────────────────────────────────────────────

/**
 * The plans on offer, from whichever provider will be asked to sell one.
 *
 * The lists differ in both contents and price, so this must never be served
 * from the other provider than the one that will fulfil it - which is why the
 * purchase stamps the provider it was prepared under.
 */
export async function dataPlans(provider: BillsProvider, network: string): Promise<any> {
  if (provider === "flutterwave") {
    return { code: "success", data: await flwDataPlans(network) };
  }
  return getDataVariations(network);
}

// ─── Validation ───────────────────────────────────────────────

export async function checkMeter(
  provider: BillsProvider,
  args: { customerId: string; disco: string; type: "prepaid" | "postpaid" },
): Promise<{ ok: boolean; name: string | null; error?: string }> {
  if (provider === "flutterwave") {
    const item = await flwElectricityItem(args.disco, args.type);
    if (!item) return { ok: false, name: null, error: `${args.disco} is not available right now` };
    return flwValidateCustomer(item.billerCode, item.itemCode, args.customerId);
  }

  try {
    const r: any = await verifyMeter(args);
    const name = r?.data?.customer_name || r?.data?.name || null;
    return { ok: !!name, name: name ? String(name).trim() : null };
  } catch (e: any) {
    return { ok: false, name: null, error: e?.response?.data?.message || e.message };
  }
}

/** Whether a disco can be paid at all on this provider. */
export function supportsDisco(provider: BillsProvider, disco: string): boolean {
  return provider === "flutterwave" ? flwSupportsDisco(disco) : true;
}

/**
 * What a cable provider sells, and for how much.
 *
 * vtu.ng has no cable product, so this is Flutterwave-only for now - and it
 * returns an empty list rather than throwing, so the screen shows "no packages
 * right now" instead of an error nobody can act on.
 */
export async function cablePackages(
  provider: BillsProvider,
  operator: string,
): Promise<{ code: string; name: string; amount: number }[]> {
  if (provider !== "flutterwave") return [];
  const items = await flwCablePackages(operator);
  return items.map((i) => ({ code: i.itemCode, name: i.name, amount: i.amount }));
}

/** Whose decoder this is. */
export async function checkSmartcard(
  provider: BillsProvider,
  args: { provider: string; packageCode: string; smartcard: string },
): Promise<{ ok: boolean; name: string | null; error?: string }> {
  if (provider !== "flutterwave") {
    return { ok: false, name: null, error: "Cable is not available right now." };
  }
  const item = await flwCableItem(args.provider, args.packageCode);
  if (!item) return { ok: false, name: null, error: "That package is no longer available." };
  return flwValidateCustomer(item.billerCode, item.itemCode, args.smartcard);
}

/**
 * Whose betting account this is, and what the provider will accept into it.
 *
 * vtu.ng only, because it is the only rail that sells betting at all - the
 * `provider` argument is taken so this reads like its siblings and so a
 * second rail later has somewhere to go, not because there is a choice today.
 *
 * `min` and `max` come back from the provider and are theirs, not ours. They
 * are returned rather than enforced here so the caller can take whichever of
 * the two ceilings binds first: SportyBet's floor is ₦100 and so is our own,
 * but a provider is free to raise theirs without telling us, and a refusal
 * quoting their number beats one quoting a number they no longer honour.
 */
export async function checkBettingAccount(
  provider: BillsProvider,
  args: { customerId: string; bettingProvider: string },
): Promise<{
  ok: boolean;
  name: string | null;
  username: string | null;
  min: number | null;
  max: number | null;
  error?: string;
}> {
  if (provider !== "vtu") {
    return { ok: false, name: null, username: null, min: null, max: null, error: "Betting is not available right now." };
  }

  try {
    const r: any = await verifyBettingAccount({
      customerId: args.customerId,
      provider: args.bettingProvider,
    });
    const d = r?.data || {};
    const name = d.customer_name ? String(d.customer_name).trim() : null;
    const num = (v: any) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      ok: !!name,
      name,
      username: d.customer_username ? String(d.customer_username).trim() : null,
      min: num(d.minimum_amount),
      max: num(d.maximum_amount),
      // A reply with no name is a lookup that did not find the account, not a
      // transport failure - so it needs a reason of its own or the screen has
      // nothing to say.
      ...(name ? {} : { error: "We could not find that account. Check the ID and try again." }),
    };
  } catch (e: any) {
    return {
      ok: false,
      name: null,
      username: null,
      min: null,
      max: null,
      error: e?.response?.data?.message || e.message,
    };
  }
}

// ─── Buying ───────────────────────────────────────────────────

export interface BillPurchase {
  ok: boolean;
  /** delivered | pending | failed */
  status: "delivered" | "pending" | "failed";
  /** The provider's own handle, for looking it up later. */
  providerRef: string | null;
  token: string | null;
  units: string | null;
  raw: any;
  error?: string;
}

export async function buyBill(
  provider: BillsProvider,
  args: {
    type: "airtime" | "data" | "electricity" | "cable" | "betting";
    /** phone, meter, smartcard or betting account id */
    customer: string;
    network: string;
    disco?: string;
    meterType?: "prepaid" | "postpaid";
    amount: number;
    variationId?: string;
    /** Ours. Stable across attempts, so a repeat can be recognised. */
    reference: string;
  },
): Promise<BillPurchase> {
  if (provider === "flutterwave") return buyOnFlutterwave(args);
  return buyOnVtu(args);
}

const DATA_BILLER_BY_NETWORK: Record<string, string> = {
  MTN: "BIL108",
  Glo: "BIL109",
  Airtel: "BIL110",
  "9Mobile": "BIL111",
};

async function buyOnFlutterwave(args: any): Promise<BillPurchase> {
  let billerCode: string;
  let itemCode: string;

  // Named rather than left to the electricity fallthrough below, which would
  // otherwise look up a disco called "SportyBet" and fail somewhere less
  // legible.
  if (args.type === "betting") {
    return fail("Betting is not available on this provider.");
  }

  if (args.type === "airtime") {
    ({ billerCode, itemCode } = FLW_AIRTIME);
  } else if (args.type === "data") {
    const biller = await flwDataPlans(args.network);
    const plan = biller.find((p) => p.variation_id === args.variationId);
    if (!plan) {
      return fail("That data plan is no longer available. Please pick another.");
    }
    // The biller is implied by the network; the item IS the plan.
    billerCode = DATA_BILLER_BY_NETWORK[args.network] || "";
    itemCode = plan.variation_id;
    if (!billerCode) return fail(`${args.network} data is not available right now`);
  } else if (args.type === "cable") {
    const item = await flwCableItem(args.network, args.variationId);
    if (!item) return fail("That package is no longer available. Please pick another.");
    billerCode = item.billerCode;
    itemCode = item.itemCode;
  } else {
    const item = await flwElectricityItem(args.disco || args.network, args.meterType || "prepaid");
    if (!item) return fail(`${args.disco || args.network} is not available right now`);
    billerCode = item.billerCode;
    itemCode = item.itemCode;
  }

  const r = await flwPayBill({
    billerCode,
    itemCode,
    customer: args.customer,
    amount: args.amount,
    reference: args.reference,
  });

  if (!r.ok) return { ...fail(r.error || "Purchase failed"), raw: r.raw };

  return {
    ok: true,
    // Flutterwave returns a completed purchase synchronously; there is no
    // pending state to poll for airtime and data.
    status: "delivered",
    providerRef: r.txRef,
    token: r.token,
    units: r.units,
    raw: r.raw,
  };
}

async function buyOnVtu(args: any): Promise<BillPurchase> {
  if (args.type === "cable") {
    return fail("Cable is not available on this provider.");
  }

  const call = () => {
    if (args.type === "airtime") {
      return purchaseAirtime({
        phone: args.customer,
        network: args.network,
        amount: args.amount,
        requestId: args.reference,
      });
    }
    if (args.type === "electricity") {
      return purchaseElectricity({
        customerId: args.customer,
        disco: args.disco || args.network,
        type: args.meterType || "prepaid",
        amount: args.amount,
        requestId: args.reference,
      });
    }
    if (args.type === "betting") {
      // The account id travels as `customer` and the bookmaker as `network`,
      // the same way a meter number and its disco do.
      return fundBettingAccount({
        customerId: args.customer,
        provider: args.network,
        amount: args.amount,
        requestId: args.reference,
      });
    }
    return purchaseData({
      phone: args.customer,
      network: args.network,
      variationId: args.variationId,
      requestId: args.reference,
    });
  };

  try {
    const r: any = await call();
    const orderStatus = r?.data?.status || "";
    const delivered =
      r?.code === "success" && (orderStatus === "completed-api" || orderStatus === "processing-api");
    return {
      ok: true,
      status: delivered ? "delivered" : "pending",
      providerRef: args.reference,
      token: null,
      units: null,
      raw: r,
    };
  } catch (e: any) {
    const data = e?.response?.data;
    return {
      ...fail(data?.message || e.message),
      raw: data || null,
    };
  }
}

/**
 * Did this reference already go out?
 *
 * The question every retry has to ask before it sends anything. Both providers
 * can answer it, by different means, and neither answer is a guess: vtu.ng by
 * requery on our request id, Flutterwave by finding our reference in its
 * history.
 */
export async function findExistingBill(
  provider: BillsProvider,
  reference: string,
): Promise<{ found: boolean; status: "delivered" | "pending" | "failed" | null; raw: any }> {
  if (provider === "flutterwave") {
    const r = await flwFindByReference(reference).catch(() => null);
    if (!r?.found) return { found: false, status: null, raw: null };
    const mapped = mapFlwBillStatus(r.status || undefined);
    return {
      found: true,
      status: mapped === "COMPLETED" ? "delivered" : mapped === "FAILED" ? "failed" : "pending",
      raw: r.raw,
    };
  }

  try {
    const r: any = await requeryOrder(reference);
    const s = r?.data?.status || "";
    if (!s) return { found: false, status: null, raw: null };
    return {
      found: true,
      status:
        s === "completed-api" || s === "processing-api"
          ? "delivered"
          : s === "refunded" || s === "failed"
          ? "failed"
          : "pending",
      raw: r,
    };
  } catch {
    // order_not_found means it never reached them, which is the one answer
    // that makes sending again safe.
    return { found: false, status: null, raw: null };
  }
}

function fail(error: string): BillPurchase {
  return { ok: false, status: "failed", providerRef: null, token: null, units: null, raw: null, error };
}
