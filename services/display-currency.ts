/**
 * Which currency balances are shown in.
 *
 * Display only: nothing here changes what is actually held or sent. A balance
 * is USDC on a chain whatever this says, and every amount that leaves the app
 * — a payout, a quote, a limit — stays in naira.
 *
 * Kept on the device rather than the server because it is a preference about
 * this phone's screen, not about the account. It is also read on first paint,
 * so a round trip would mean a flash of the wrong unit.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@displayCurrency";

export type DisplayCurrency = "NGN" | "USD";

export const DISPLAY_CURRENCIES: {
  code: DisplayCurrency;
  name: string;
  flag: string;
  symbol: string;
}[] = [
  { code: "NGN", name: "Nigerian Naira", flag: "🇳🇬", symbol: "₦" },
  { code: "USD", name: "US Dollar", flag: "🇺🇸", symbol: "$" },
];

/**
 * Only the two the rate feed actually carries.
 *
 * services/rates.ts returns `usd` and `ngn` per token and nothing else, so
 * offering EUR or GBP here would mean inventing a number or showing a naira
 * figure with a pound sign in front of it. Adding either means an FX source
 * first; the list is then one entry each.
 */

export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "USD" ? "USD" : "NGN";
  } catch {
    // A device that cannot read storage still has to render something.
    return "NGN";
  }
}

export async function setDisplayCurrency(code: DisplayCurrency): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // Not worth failing a settings tap over; the choice just will not persist.
  }
}

export function currencySymbol(code: DisplayCurrency): string {
  return DISPLAY_CURRENCIES.find((c) => c.code === code)?.symbol ?? "₦";
}
