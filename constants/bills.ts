import { ImageSourcePropType } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ServiceKey } from "@/constants/services";

/**
 * The bill categories, and what each one is called by the people paying it.
 *
 * `keywords` is what makes the search useful: nobody searches for "Airtime",
 * they search for "MTN". Typing a provider surfaces the category that sells it,
 * which is the screen they were going to have to reach anyway.
 */
export interface BillCategory {
  key: string;
  label: string;
  /** Where the card goes, params included. */
  route: string;
  params?: Record<string, string>;
  /**
   * The oversized watermark in the corner of the card. A drawn mark where we
   * have one, a glyph where we do not - there is no TV artwork in the set, and
   * inventing one to match four others is not worth the mismatch.
   */
  art?: ImageSourcePropType;
  icon?: keyof typeof Feather.glyphMap;
  /** Providers, for search. Matched case-insensitively on substrings. */
  keywords: string[];
  /**
   * Listed, but not yet takeable. Shown rather than hidden so "do you do
   * electricity?" gets an answer here instead of being inferred from an
   * absence - the screen behind it exists, it just is not open.
   *
   * Different from paused, and it wins over it: "coming soon" is a thing we
   * have not built, "under maintenance" is a thing that normally works.
   */
  soon?: boolean;
  /**
   * The pause switch this card answers to.
   *
   * Airtime and data share one - they are the same provider call and the same
   * switch turns both off. Turning a service off in the console marks the card
   * before anybody taps it, rather than letting them pick a provider, type an
   * amount and meet a 503.
   */
  service?: ServiceKey;
}

export const BILL_CATEGORIES: BillCategory[] = [
  {
    key: "airtime",
    label: "Airtime",
    route: "/airtime",
    params: { tab: "airtime" },
    art: require("@/assets/images/telephone-call.png"),
    keywords: ["MTN", "Airtel", "Glo", "9Mobile", "Etisalat", "recharge", "top up", "credit"],
    service: "airtime",
  },
  {
    key: "data",
    label: "Data & Internet",
    route: "/airtime",
    params: { tab: "data" },
    art: require("@/assets/images/wifi.png"),
    keywords: ["MTN", "Airtel", "Glo", "9Mobile", "internet", "broadband", "wifi", "bundle"],
    // Its own switch. One provider call, but they fail separately - a rail can
    // vend airtime and not vend data, and one switch would force a choice
    // between turning off what works and leaving on what does not.
    service: "data",
  },
  {
    key: "electricity",
    label: "Electricity",
    route: "/electricity",
    // No longer pinned shut in the app: the console switch decides, so it can
    // be turned off and back on without shipping a build to do it.
    service: "electricity",
    art: require("@/assets/images/flash.png"),
    keywords: [
      "EKEDC", "Eko", "KEDCO", "Kano", "PHED", "Port Harcourt", "JED", "Jos",
      "IBEDC", "Ibadan", "KAEDCO", "Kaduna", "AEDC", "Abuja", "EEDC", "Enugu",
      "BEDC", "Benin", "ABEDC", "Aba", "YEDC", "Yola", "NEPA", "prepaid", "meter", "units",
    ],
  },
  {
    key: "tv",
    label: "TV",
    route: "/tv",
    /**
     * Held shut by the console switch, not by a flag in a build.
     *
     * The screen exists but nothing serves it yet, so the cable switch starts
     * paused and the card reads "Under maintenance" - which is also the honest
     * word for it, and unlike `soon` it can be lifted the day cable ships
     * without shipping an app to do it. Do not resume it before then: the
     * screen behind this has no backend.
     */
    service: "cable",
    icon: "tv",
    keywords: ["DSTV", "GOtv", "Startimes", "cable", "decoder", "subscription"],
  },
  {
    key: "betting",
    label: "Betting",
    route: "/betting",
    service: "betting",
    art: require("@/assets/images/football.png"),
    // The twelve bookmakers we do not carry are listed anyway. Somebody
    // searching "BetKing" should find this card and see for themselves that we
    // do two, rather than conclude we do none.
    keywords: [
      "SportyBet", "Bet9ja", "betting", "bet", "bookmaker", "sports", "stake",
      "fund", "1xBet", "BetKing", "NairaBet", "MerryBet", "BetWay",
    ],
  },
];

/**
 * Marks for providers we have artwork for, keyed by the name bills store in
 * `metadata.network`. Used by the recents row, where a logo is what makes a
 * past purchase recognisable at a glance.
 *
 * Deliberately partial: a provider with no logo falls back to its initials
 * rather than being left out of your own history.
 */
export const PROVIDER_LOGOS: Record<string, ImageSourcePropType> = {
  MTN: require("@/assets/images/MTN.jpg"),
  AIRTEL: require("@/assets/images/AIRTEL.jpg"),
  GLO: require("@/assets/images/GLO.png"),
  "9MOBILE": require("@/assets/images/9MOBILE.webp"),
  EKEDC: require("@/assets/images/ekedc.png"),
  KEDCO: require("@/assets/images/Kedco.jpg"),
  PHED: require("@/assets/images/PHED.png"),
  JED: require("@/assets/images/JED.jpeg"),
  IBEDC: require("@/assets/images/IBEDC.webp"),
  KAEDCO: require("@/assets/images/KAEDCO.jpg"),
  AEDC: require("@/assets/images/AEDC-logo.jpg"),
  EEDC: require("@/assets/images/EEDC.webp"),
  BEDC: require("@/assets/images/bedc.png"),
  YEDC: require("@/assets/images/YEDC.webp"),
  // Bookmakers. Keyed upper-case like the rest, because the recents row
  // upper-cases metadata.network before looking it up - and betting stores
  // the provider there with its own capitalisation ("SportyBet").
  SPORTYBET: require("@/assets/images/sportybet.png"),
  BET9JA: require("@/assets/images/bet9ja.png"),
};

/** How a past bill is labelled in the recents row. */
export function billLabel(billType?: string, network?: string): string {
  const provider = network || "Bill";
  if (billType === "data") return `Data-${provider}`;
  if (billType === "airtime") return `Airtime-${provider}`;
  if (billType === "electricity") return `${provider} Electricity`;
  // The bookmaker's name is already the whole label - "SportyBet Betting"
  // says nothing the first word did not.
  if (billType === "betting") return provider;
  return provider;
}

/** Which category screen a past bill should reopen. */
export function billCategory(billType?: string): BillCategory {
  return (
    BILL_CATEGORIES.find((c) => c.key === billType) ||
    BILL_CATEGORIES[0]
  );
}
