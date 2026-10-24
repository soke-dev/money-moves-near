import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Platform,
  Modal,
  Pressable,
  Clipboard,
  Alert,
  Image,
  ActivityIndicator,
  Animated,
  AppState,
  type ImageSourcePropType,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { getDisplayCurrency, type DisplayCurrency } from "@/services/display-currency";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
// Aliased: react-native's own Animated already owns the name in this file.
import Reanimated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import UpdateStub from "@/components/UpdateStub";
import { TransactionItem } from "@/components/TransactionItem";
import { WalletSetupModal } from "@/components/WalletSetupModal";
import { WalletRecoveryModal } from "@/components/WalletRecoveryModal";
import { WalletTypeChooser } from "@/components/WalletTypeChooser";
import { UsernameSheet } from "@/components/UsernameSheet";
import { WelcomeBackSheet } from "@/components/WelcomeBackSheet";
import { ReferralPromptSheet } from "@/components/ReferralPromptSheet";
import { BackgroundAlertsSheet } from "@/components/BackgroundAlertsSheet";
import { BusinessLinkSheet } from "@/components/BusinessLinkSheet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getBusinessLinks, type BusinessLink } from "@/services/business-links";
import { takeBusinessPayCode } from "@/services/business-payments";
import * as Notifications from "expo-notifications";
import { storeUpdateRequired } from "@/services/store-update";
import {
  getUnreadCount,
  registerForPushNotifications,
  attachNotificationRouting,
} from "@/services/notifications";
import { FONT_SCALE, spendableBalance } from "@/constants/transfer";
import { useServiceStatus } from "@/hooks/useServiceStatus";
import { PausedCard, type PausedDetail } from "@/components/PausedSheet";
import { getSweepQuote, type SweepQuote } from "@/services/sweep";
import { getSwapConfig } from "@/services/swap";
import {
  PAUSED_TITLES,
  PAUSED_FALLBACK,
  PAUSED_NOTE,
  type ServiceKey,
} from "@/constants/services";
// ₦110K Trading Competition — Sun 24 May 2026 00:00 → Sun 7 Jun 2026 00:00 Lagos (UTC+1)
const COMPETITION_START_MS = Date.UTC(2026, 4, 23, 23, 0, 0, 0);
const COMPETITION_END_MS = Date.UTC(2026, 5, 6, 23, 0, 0, 0);
const COMP_DISMISS_KEY = "@compCardDismissed_v1";
const COMP_REAPPEAR_MS = 6 * 60 * 60 * 1000; // re-show 6h after dismiss until end of competition

function getCompetitionStatus(now: number): "upcoming" | "live" | "ended" {
  if (now < COMPETITION_START_MS) return "upcoming";
  if (now < COMPETITION_END_MS) return "live";
  return "ended";
}

/**
 * The four actions on the balance, as circles.
 *
 * `solid` marks the one filled action. A row of four identical outlines has no
 * primary, and sending money is the thing people come here to do.
 *
 * This replaces both the old Deposit/Transfer pair and the coloured quick-action
 * tiles, which between them offered six entry points and read as two competing
 * rows. Electricity and Savings lose their tile here - Savings is otherwise
 * only reachable from this screen, so it still needs a home.
 */
/**
 * Opacity ramp for the allocation bar, brightest first.
 *
 * The bar is sorted by value, so falling opacity means the largest holding is
 * also the strongest - the order reads without a legend, and it stays in the
 * brand colour instead of inventing a palette per asset.
 */
/**
 * Figures and chain lists in the asset ledger are monospaced, so the columns
 * line up down the screen rather than only across a row.
 */
const ASSET_MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/**
 * How money gets in. Only rails that work - a dimmed row you cannot press is a
 * promise the screen has no way to keep.
 *
 * Each line says what you do and what you end up with. "Bank transfer to your
 * account number" described the plumbing and left the obvious question hanging
 * - whose account number, and what do I get back? Nobody comes here wanting a
 * transfer; they want crypto, and naira is what they have.
 */
/**
 * Two ways in, side by side.
 *
 * The sub-line says where the money comes from, which is the thing that
 * actually separates them - it used to restate the title.
 */
const DEPOSIT_METHODS: {
  label: string;
  sub: string;
  route: string;
  image: any;
  service?: ServiceKey;
}[] = [
  {
    label: "Deposit crypto",
    sub: "From another wallet",
    route: "/select-crypto",
    image: require("@/assets/images/qr-code.png"),
  },
  {
    label: "Deposit fiat",
    sub: "From your bank",
    route: "/deposit-fiat",
    image: require("@/assets/images/bank.png"),
    service: "funding",
  },
];

/**
 * How money leaves, in the order people reach for it.
 *
 * The same three the /transfer screen offers - this is that screen as a sheet,
 * because picking between three things does not need a page of its own.
 */
const SEND_METHODS: {
  label: string;
  sub: string;
  route: string;
  image: any;
  /** Which pause switch this row answers to, if any. */
  service?: ServiceKey;
}[] = [
  {
    label: "Bank Transfer",
    sub: "Local fiat, into any bank account",
    route: "/sell",
    image: require("@/assets/images/bank.png"),
    service: "bank",
  },
  // Above the on-chain row on purpose: sending to a username is the one most
  // people reach for, and it was sitting under the option that asks them for
  // an address.
  {
    label: "Send to Username",
    sub: "To another Money Moves user",
    route: "/username-lookup",
    image: require("@/assets/images/user.png"),
    service: "username",
  },
  {
    label: "Crypto Transfer",
    sub: "On-chain, to any wallet address",
    route: "/withdraw-select",
    image: require("@/assets/images/send.png"),
    service: "withdraw",
  },
];

const ACTIONS: {
  label: string;
  route: string;
  solid: boolean;
  icon?: keyof typeof Feather.glyphMap;
  image?: ImageSourcePropType;
  /**
   * Per-icon override, because these are drawn on different grids. The receipt
   * carries a margin inside its own canvas where the paper plane runs edge to
   * edge, so at one shared size the receipt reads noticeably smaller.
   */
  imageSize?: number;
  /**
   * Opens the deposit sheet rather than navigating.
   *
   * Money can arrive two ways and they are nothing alike - naira through a bank
   * transfer, or crypto to an address. One tile cannot mean both, and picking
   * one silently would send half the people who tap it to the wrong screen.
   */
  sheet?: boolean;
  /** Opens the send chooser rather than navigating. */
  sendSheet?: boolean;
}[] = [
  { image: require("@/assets/images/plus.png"), label: "Deposit", route: "", solid: false, sheet: true },
  { image: require("@/assets/images/receipt.png"), label: "Pay bills", route: "/bills", solid: false, imageSize: 21 },
  // Reads account numbers, Money Moves usernames and (later) merchant codes,
  // and goes wherever what it read belongs.
  { image: require("@/assets/images/qr-code.png"), label: "Scan & pay", route: "/scan", solid: false },
  { image: require("@/assets/images/send.png"), label: "Send money", route: "", solid: true, imageSize: 20, sendSheet: true },
];

/**
 * The verification reminder, at most once a day per account.
 *
 * It was once per session, and a session is every PIN or Face ID unlock - so
 * somebody who opened the app five times a day was asked five times, which
 * reads as nagging rather than as a reminder. Now it is once every 24 hours,
 * remembered on the phone so closing the app does not reset it.
 *
 * `kycOfferAt` mirrors the stored time in memory and is written before the
 * storage write, so two callers racing on the same launch - the arrival
 * effect and a chained sheet - cannot both be told yes: whichever resumes
 * second finds the first one's claim already there.
 */
const KYC_OFFER_EVERY_MS = 24 * 60 * 60 * 1000;
const kycOfferAt: Record<string, number> = {};
const kycOfferKey = (userId: string) => `mm_kyc_offer_at_${userId}`;

/**
 * Is there anything to ask this account for?
 *
 * Not while a submission is being decided. Someone who has just sent their ID
 * off and is waiting on a provider has done the thing being asked of them, and
 * telling them to do it again reads as though it did not register. PENDING is
 * "with the provider"; NONE and REJECTED are the two that still want an action.
 */
function needsVerifying(user: { verified?: boolean; kycStatus?: string | null } | null): boolean {
  if (!user || user.verified) return false;
  return user.kycStatus !== "PENDING";
}

/**
 * At most one popup on arrival, per unlock.
 *
 * Home can greet somebody with several things - the verification reminder, the
 * referral prompt - and each on its own is reasonable while two in a row is
 * the "too much" people complained about. So whichever is claimed first takes
 * the unlock, and the other waits for a later one. Keyed on the session
 * number, which ticks on every unlock and is never -1.
 */
let arrivalTakenFor = -1;

async function claimKycOffer(userId: string | undefined, session: number): Promise<boolean> {
  if (!userId || arrivalTakenFor === session) return false;
  let last = kycOfferAt[userId];
  if (last === undefined) {
    const stored = await AsyncStorage.getItem(kycOfferKey(userId)).catch(() => null);
    // Asked again after the await: another caller may have claimed meanwhile.
    last = kycOfferAt[userId] ?? (Number(stored) || 0);
  }
  if (arrivalTakenFor === session) return false;
  const now = Date.now();
  // A time in the future means the phone's clock was moved back; treat it as
  // stale rather than let it silence the reminder until the clock catches up.
  if (last <= now && now - last < KYC_OFFER_EVERY_MS) return false;
  kycOfferAt[userId] = now;
  arrivalTakenFor = session;
  AsyncStorage.setItem(kycOfferKey(userId), String(now)).catch(() => {});
  return true;
}

/**
 * The "did a friend invite you?" prompt: once per account, ever.
 *
 * Shown the first time Home is opened on a version that has it, to somebody
 * still inside the week they may add a code in. After that it never appears
 * again - adding a code stays possible from the referral page, the Loyalty
 * page and Account for the rest of the week, which is where people go looking
 * once they know it exists. Mirrored in memory before the storage write, like
 * the reminder above, so two callers cannot both be told yes.
 */
const refPromptSeen: Record<string, boolean> = {};
const refPromptKey = (userId: string) => `mm_ref_prompt_${userId}`;

async function claimReferralPrompt(userId: string, session: number): Promise<boolean> {
  if (arrivalTakenFor === session) return false;
  let seen = refPromptSeen[userId];
  if (seen === undefined) {
    const stored = await AsyncStorage.getItem(refPromptKey(userId)).catch(() => null);
    seen = refPromptSeen[userId] ?? stored === "1";
  }
  if (seen || arrivalTakenFor === session) return false;
  refPromptSeen[userId] = true;
  arrivalTakenFor = session;
  AsyncStorage.setItem(refPromptKey(userId), "1").catch(() => {});
  return true;
}

/**
 * The "alerts when the app is closed" prompt: Android only, once per phone.
 *
 * Per phone rather than per account, because what it fixes is a setting on the
 * handset. Only once notifications are allowed at all - asking someone to let
 * background alerts through for an app they have muted would be noise. Last in
 * line behind the referral prompt and the verification reminder.
 */
let bgPromptSeen: boolean | undefined;
const BG_PROMPT_KEY = "mm_bg_alerts_prompt_v1";

async function claimBackgroundPrompt(session: number): Promise<boolean> {
  if (Platform.OS !== "android" || arrivalTakenFor === session) return false;
  if (bgPromptSeen === undefined) {
    const stored = await AsyncStorage.getItem(BG_PROMPT_KEY).catch(() => null);
    bgPromptSeen = bgPromptSeen ?? stored === "1";
  }
  if (bgPromptSeen || arrivalTakenFor === session) return false;
  const perm = await Notifications.getPermissionsAsync().catch(() => null);
  if (perm?.status !== "granted" || bgPromptSeen || arrivalTakenFor === session) return false;
  bgPromptSeen = true;
  arrivalTakenFor = session;
  AsyncStorage.setItem(BG_PROMPT_KEY, "1").catch(() => {});
  return true;
}

/**
 * Which arrival popup to show now, if any.
 *
 * The referral prompt goes first: it can only ever happen once, and only in a
 * new account's first week, while the verification reminder comes back
 * tomorrow. Nothing is decided on a user restored from a cache written before
 * this version knew about referrals - `referralClaim` is undefined only
 * there - because deciding on that would hand the unlock to the reminder
 * and push the one-time prompt back a launch.
 */
async function nextArrivalPopup(
  user: { id?: string; verified?: boolean; kycStatus?: string | null; referralClaim?: { open: boolean } } | null,
  session: number,
): Promise<"referral" | "kyc" | "background" | null> {
  if (!user?.id || user.referralClaim === undefined) return null;
  // Not while the update screen is taking over: the one-time prompt would be
  // spent on a Home that is already going.
  if (storeUpdateRequired()) return null;
  if (user.referralClaim.open && (await claimReferralPrompt(user.id, session))) return "referral";
  if (needsVerifying(user) && (await claimKycOffer(user.id, session))) return "kyc";
  if (await claimBackgroundPrompt(session)) return "background";
  return null;
}

/** What the business-request sheet becomes if it ever fails to draw: nothing. Home carries on. */
const NoSheet = () => null;

export default function HomeScreen() {
  const colors = useColors();
  const svc = useServiceStatus();

  /**
   * What is worth gathering, if anything.
   *
   * Re-asked every time this screen comes back, not once on mount: the sweep
   * sheet returns here having emptied the very balances this answer was about,
   * and a stale yes would leave a tag offering a sweep with nothing in it.
   *
   * Failures are silent, and null hides the tag. This is a suggestion, not a
   * feature anybody is waiting on.
   */
  const [sweepable, setSweepable] = useState<SweepQuote | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getSweepQuote()
        .then((q) => alive && setSweepable(q))
        .catch(() => alive && setSweepable(null));
      return () => {
        alive = false;
      };
    }, []),
  );

  /**
   * Nothing to swap, nothing to show — and a spent allowance is not nothing.
   *
   * The tag used to need an allowance left as well as a balance to move, which
   * meant somebody who had used their three for the week watched the button
   * disappear with money still scattered across chains. There is no way to
   * tell that apart from a broken feature from the outside, and it was read as
   * one.
   *
   * So the tag stays up whenever there is something to gather, and the sheet
   * says how many are left and when the next one comes back. The server
   * refuses a fourth anyway, so nothing here is load-bearing - this only
   * decides whether the answer is reachable.
   */
  const canSweep = !!sweepable && sweepable.balances.length > 0;

  /**
   * Swapping between chains, when the server offers it.
   *
   * Its own tag beside Sweep. The two split balances by size: Sweep takes
   * the small ones (the swap minimum and under) into USDCx on Movement, and
   * Swap takes anything bigger, any coin to any chain.
   */
  const [swapOn, setSwapOn] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getSwapConfig()
        .then((c) => alive && setSwapOn(!!c.enabled))
        .catch(() => alive && setSwapOn(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  /**
   * Say it here rather than let them find out three screens in.
   *
   * The server has always refused a paused service; what it could not do was
   * say so before somebody had picked an account and typed an amount. The
   * message and the time both come from the console, so this reads whatever
   * was written at the moment the switch was flipped.
   */
  const pausedDetail = (key: ServiceKey): PausedDetail => {
    const state = svc.detail(key);
    return {
      title: PAUSED_TITLES[key],
      message:
        state?.message?.trim() || PAUSED_FALLBACK,
      backBy: state?.backBy,
      // Only offered when it is genuinely a way round - another way to send
      // money that is itself still on.
      action:
        key === "bank" && !svc.paused("username")
          ? {
              label: "Send to a username instead",
              onPress: () => {
                setShowSendSheet(false);
                setShowDepositSheet(false);
                requireWallet(() => router.push("/username-lookup" as any));
              },
            }
          : null,
    };
  };
  /**
   * A paused option, explained inside the sheet it was tapped in.
   *
   * The sheet used to close and raise the pause notice in the same tap - two
   * pop-ups swapping at once, which on iPhone can leave an invisible layer over
   * the app that swallows every tap until it is restarted. Shown in place, there
   * is only ever one, and the other ways to send are a "Got it" away.
   */
  const [sheetPaused, setSheetPaused] = useState<ServiceKey | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletError, retryWalletSetup, user, ngnBalance, usdcBalance, usdtBalance, usdcxBalance, cngnBalance, moveBalance, solBalance, transactions, refreshUser, walletReady, hasWallet, walletType, walletBalances, balancesLoading, connectWallet, refreshBalances, refreshTransactions, rates, unlocked, sessionId } = useApp();

  const usdBalance = useMemo(() => {
    if (!rates) return 0;
    return (
      usdcBalance * (rates.USDC?.usd || 0) +
      usdtBalance * (rates.USDT?.usd || 0) +
      usdcxBalance * (rates.USDC?.usd || 0) +
      moveBalance * (rates.MOVE?.usd || 0) +
      solBalance * (rates.SOL?.usd || 0) +
      // About $0.0007 each, so a naira balance shows up here at its real
      // dollar worth rather than being left out of the total it belongs to.
      cngnBalance * (rates.cNGN?.usd || 0)
    );
  }, [usdcBalance, usdtBalance, usdcxBalance, moveBalance, solBalance, cngnBalance, rates]);
  /**
   * Hides every figure on the screen, not only the headline.
   *
   * The eye covered the total and left the assets tab underneath showing each
   * holding and its dollar value - which add up to the number just covered. A
   * balance is not hidden while the page still shows its parts.
   */
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [showDepositSheet, setShowDepositSheet] = useState(false);
  const [showSendSheet, setShowSendSheet] = useState(false);
  // KYC + username sheets are sequenced by the onboarding effect below (username
  // first, then KYC) so a fresh sign-up isn't hit with two sheets at once.
  const [showKycSheet, setShowKycSheet] = useState(false);
  const [showRefSheet, setShowRefSheet] = useState(false);
  const [showBgSheet, setShowBgSheet] = useState(false);
  /**
   * Businesses asking to be paid into this account, answered right here.
   *
   * Looked for when Home comes into view, when the app comes back to the
   * front, and when the request's notification lands while the app is open -
   * so the sheet comes up on its own, not only from the notification. "Not
   * now" holds a request back for the rest of this run of the app; it comes
   * up again next time, and waits in Security > Linked businesses meanwhile.
   */
  const [linkRequests, setLinkRequests] = useState<BusinessLink[]>([]);
  const heldBack = useRef(new Set<string>());
  const homeFocused = useIsFocused();
  /**
   * The user has been re-read from the server since this screen mounted.
   * Arrival popups wait for it, so they decide on today's answer rather than
   * whatever the offline cache last held.
   */
  const [userFresh, setUserFresh] = useState(false);
  const [showUsernameSheet, setShowUsernameSheet] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [showWalletErrorSheet, setShowWalletErrorSheet] = useState(false);
  const [walletRetrying, setWalletRetrying] = useState(false);
  // Which account the onboarding check has already run for. A plain boolean
  // meant signing into a second account on the same device skipped it.
  const onboardCheckedFor = useRef<string | null>(null);
  // Transactions first: it is what the reference leads with, and what someone
  // opening the app is usually checking. Assets is the deliberate second look.
  const [homeTab, setHomeTab] = useState<"wallet" | "transactions">("transactions");
  const [walletConnecting, setWalletConnecting] = useState(false);

  /**
   * First run: pick a username, then verify identity.
   *
   * Both sheets are offered once, in that order, so a fresh sign-up is not hit
   * with two at the same time. The username one only appears while the handle
   * is still the one we generated - someone who has chosen their own is not
   * asked again.
   *
   * The "already asked" flag is per account. It used to be a single global
   * key, so the second person to sign up on a device - or the same person
   * testing a new account - silently skipped the prompt.
   */
  useEffect(() => {
    if (!user?.id || onboardCheckedFor.current === user.id) return;
    onboardCheckedFor.current = user.id;

    (async () => {
      /**
       * An account that predates the rebuild hears what changed, once.
       *
       * V2_LAUNCH is the line: anything created before it belongs to the old
       * system, whose users arrive to no password, a new wallet and a
       * verification they thought they had already done. Set it to the day
       * this version ships.
       */
      const V2_LAUNCH = Date.parse("2026-09-13T00:00:00Z");
      const welcomeKey = `mm_welcome_v2_${user.id}`;
      const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
      const isReturning = Number.isFinite(created) && created < V2_LAUNCH;

      if (isReturning && !(await AsyncStorage.getItem(welcomeKey).catch(() => null))) {
        setShowWelcomeBack(true);
        return;
      }

      const key = `mm_username_prompted_${user.id}`;
      const prompted = await AsyncStorage.getItem(key).catch(() => null);

      // Both shapes the backend generates: "chidi_48213" and the collision
      // fallback "user_m1a2b3".
      const handle = user.username || "";
      const looksGenerated = /_\d{3,}$/.test(handle) || /^user_[a-z0-9]{6,}$/i.test(handle);

      if (!prompted && looksGenerated) {
        setShowUsernameSheet(true);
        return;
      }

      // Nothing more to decide here: the arrival effect below picks the next
      // popup, referral prompt or verification reminder, once the user has
      // been refreshed - so this path and that one can never both open one.
      AsyncStorage.setItem(key, "1").catch(() => {});
    })();
  }, [user?.id, user?.username, user?.verified]);
  const [showWalletSetup, setShowWalletSetup] = useState(false);
  const [showWalletRecovery, setShowWalletRecovery] = useState(false);
  const [walletSkipped, setWalletSkipped] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [walletRestoredMsg, setWalletRestoredMsg] = useState(false);
  const [compStatus, setCompStatus] = useState(() => getCompetitionStatus(Date.now()));
  // undefined = still loading from AsyncStorage; null = never dismissed; number = dismissed timestamp (ms)
  const [compDismissedAt, setCompDismissedAt] = useState<number | null | undefined>(undefined);
  const [nowTick, setNowTick] = useState(Date.now());
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // Load competition card dismissal timestamp once
  useEffect(() => {
    AsyncStorage.getItem(COMP_DISMISS_KEY).then((v) => {
      if (!v) return setCompDismissedAt(null);
      const ts = parseInt(v, 10);
      setCompDismissedAt(Number.isFinite(ts) ? ts : null);
    });
  }, []);

  // Auto-flip Upcoming → Live → Ended + re-evaluate dismiss cooldown each minute
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setCompStatus(getCompetitionStatus(now));
      setNowTick(now);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const dismissCompCard = useCallback(async () => {
    const ts = Date.now();
    setCompDismissedAt(ts);
    try { await AsyncStorage.setItem(COMP_DISMISS_KEY, String(ts)); } catch {}
  }, []);

  const stillCoolingDown =
    typeof compDismissedAt === "number" &&
    nowTick - compDismissedAt < COMP_REAPPEAR_MS;

  const showCompCard =
    compDismissedAt !== undefined &&  // AsyncStorage load resolved
    compStatus !== "ended" &&
    !stillCoolingDown;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([refreshBalances(), refreshTransactions()]); } catch {} finally { setRefreshing(false); }
  }, [refreshBalances, refreshTransactions]);

  // Fetch unread notification count on focus + register push token
  useFocusEffect(
    useCallback(() => {
      getUnreadCount().then(setUnreadNotifs).catch(() => {});
    }, [])
  );

  // Register push notifications only after session is confirmed via PIN/auth
  useEffect(() => {
    if (user && unlocked) registerForPushNotifications().catch(() => {});
  }, [user?.id, unlocked]);

  // Tapped notifications route from here for the same reason: this screen only
  // exists once the app is unlocked, so nothing can navigate over the PIN pad.
  useEffect(() => {
    if (!user || !unlocked) return;
    return attachNotificationRouting();
  }, [user?.id, unlocked]);

  const [showBackupBanner, setShowBackupBanner] = useState(false);

  // Show backup banner (non-blocking) for users who haven't backed up yet,
  // or recovery modal for returning users on a new device
  const backupKey = user ? `@walletBackedUp_${user.id}` : "@walletBackedUp";
  useEffect(() => {
    if (!user || walletSkipped) return;
    // Email (embedded) wallets have no 12-word phrase — nothing to back up, and
    // recovery is via email sign-in, not the mnemonic restore modal.
    if (walletType === "EMBEDDED") return;
    if (walletReady) {
      // Wallet is on device — show backup banner if not done yet
      AsyncStorage.getItem(backupKey).then((v) => {
        if (v !== "true" && v !== "skipped") setShowBackupBanner(true);
      });
      return;
    }
    if (hasWallet) {
      // Server has addresses but device has no mnemonic — restore needed
      setShowWalletRecovery(true);
    }
  }, [user, walletReady, hasWallet, walletSkipped, walletType, backupKey]);

  const requireWallet = (action: () => void) => {
    if (!walletReady) {
      if (hasWallet) {
        setShowWalletRecovery(true);
      } else {
        setShowWalletErrorSheet(true);
      }
      return;
    }
    action();
  };

  useEffect(() => {
    refreshUser().finally(() => setUserFresh(true));
  }, []);

  const lookForLinkRequests = useCallback(() => {
    if (!user || !unlocked) return;
    getBusinessLinks()
      .then((all) => {
        const waiting = all
          .filter((l) => l.status === "PENDING" && !heldBack.current.has(l.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        // What an open sheet shows stays put - a refresh only adds to it, never pulls one out from under a thumb.
        setLinkRequests((cur) => (cur.length ? [...cur, ...waiting.filter((w) => !cur.some((c) => c.id === w.id))] : waiting));
      })
      .catch(() => {});
  }, [user?.id, unlocked]);

  useFocusEffect(
    useCallback(() => {
      lookForLinkRequests();
    }, [lookForLinkRequests])
  );

  // A checkout link that opened the app while it was locked: now they're in, open the payment.
  useEffect(() => {
    if (!user || !unlocked || !homeFocused) return;
    const code = takeBusinessPayCode();
    if (code) router.push({ pathname: "/business-pay", params: { code } } as any);
  }, [user?.id, unlocked, homeFocused]);

  useEffect(() => {
    if (!user || !unlocked) return;
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") lookForLinkRequests();
    });
    // The request's own notification, landing while the app is open: no need to wait for a tap.
    const arrived = Notifications.addNotificationReceivedListener((n) => {
      const kind = n.request.content.data?.type;
      if (kind === "business_link" || kind === "business_payment") lookForLinkRequests();
    });
    return () => {
      back.remove();
      arrived.remove();
    };
  }, [user?.id, unlocked, lookForLinkRequests]);

  /**
   * Up when there is something to answer and Home is what they're looking at -
   * a Modal draws over every screen, so it waits for them to come back here -
   * and never on top of another sheet: whichever opened first finishes first.
   * The arrival popups wait for the requests in turn (linkWaiting, not
   * whether the sheet is showing), so leaving Home can't open one elsewhere.
   */
  const linkWaiting = linkRequests.length > 0;
  const linkSheetUp =
    homeFocused &&
    linkRequests.length > 0 &&
    !(showWelcomeBack || showUsernameSheet || showWalletSetup || showWalletRecovery || showWalletErrorSheet || showKycSheet || showRefSheet || showBgSheet || showDepositSheet || showSendSheet);
  // A business payment is never waiting here: it only exists because this person scanned or tapped it, and the pay screen they opened is where it lives.

  /**
   * Offer verification once, when they come in, and only once we actually know
   * the answer.
   *
   * This used to be `setShowKycSheet(!user?.verified)`, which is true while
   * `user` is still null - so the sheet appeared on mount before anything had
   * loaded, and again on every return to Home. If the user was genuinely
   * unverified it was unskippable in practice: dismissing it only lasted until
   * the next navigation back.
   */
  useEffect(() => {
    if (!user) return;
    // Verified since the reminder opened: take it away. Not a return - a
    // verified account can still be owed the referral prompt.
    if (!needsVerifying(user)) setShowKycSheet(false);
    if (!userFresh) return;
    /**
     * Never on top of another sheet. The welcome and username sheets are the
     * first-run sequence, and the wallet ones are about whether the account
     * works at all. They are in the dependencies, so closing one of them
     * brings this back round to decide what comes next - which is how the
     * first-run sequence now hands on, rather than each sheet opening the
     * next one itself.
     */
    if (showWelcomeBack || showUsernameSheet || showWalletSetup || showWalletRecovery || showWalletErrorSheet || linkWaiting) return;
    /**
     * No cancel on cleanup, deliberately. This re-runs whenever a refresh
     * replaces the user object, and cancelling would spend a claim - the
     * one-time prompt or the day's reminder - with nothing then shown.
     */
    nextArrivalPopup(user, sessionId).then((which) => {
      if (which === "referral") setShowRefSheet(true);
      else if (which === "kyc") setShowKycSheet(true);
      else if (which === "background") setShowBgSheet(true);
    });
  }, [
    user,
    userFresh,
    sessionId,
    showWelcomeBack,
    showUsernameSheet,
    showWalletSetup,
    showWalletRecovery,
    showWalletErrorSheet,
    linkWaiting,
  ]);

  // Ten, with a way through to the rest underneath. Five was short enough that
  // the list read as a teaser rather than as your recent activity.
  const recentTx = transactions.slice(0, 10);
  const cLogo = [styles.chainLogo, { borderColor: colors.card }];
  const cLogoFirst = [styles.chainLogo, { marginLeft: 0, borderColor: colors.card }];
  const [expandedToken, setExpandedToken] = useState<string | null>(null);

  /**
   * Zero at the precision it is written at — see the note in walletTokens.
   * Declared out here because both the grouping and the rows ask it.
   */
  const holdsAt = (amount: number, decimals: number) => Number(amount.toFixed(decimals)) > 0;
  /**
   * Whether a chain is worth listing under its coin: only what could actually be sent.
   * TON holds back 0.02 USDT for the relay and Arc keeps USDC for gas, so a balance
   * at or under that reserve is dust the person cannot move, and listing it invites
   * a send that fails. The coin's total still counts it - it is still theirs.
   */
  const listsAt = (c: { tag: string; balance: number }, decimals: number) =>
    holdsAt(spendableBalance(c.tag, c.balance), decimals);

  type ChainBalance = { name: string; tag: string; logo: any; balance: number };
  type WalletToken = { symbol: string; total: number; decimals: number; chains: ChainBalance[]; chainLogos: any[] };

  const cb = (asset: string, chain: string) =>
    walletBalances.find(w => w.asset === asset && w.chain === chain)?.balance ?? 0;

  const walletTokens: WalletToken[] = useMemo(() => {
    const tokens: WalletToken[] = [
      {
        // Canonical USDC. On Movement the native USDC is the USDCx asset, so it
        // represents the Movement chain here; Base/Solana/BNB are native USDC.
        symbol: "USDC", total: cb("USDCx", "MOVE") + cb("USDC", "BASE") + cb("USDC", "SOL") + cb("USDC", "BEP20") + cb("USDC", "ARC") + cb("USDC", "STELLAR") + cb("USDC", "MONAD"), decimals: 2,
        chains: [
          { name: "Movement", tag: "MOVE", logo: require("@/assets/images/movementnew.jpg"), balance: cb("USDCx", "MOVE") },
          // Arc pays gas in USDC, so this row is both the balance and the fuel.
          { name: "Arc", tag: "ARC", logo: require("@/assets/images/ARC.jpg"), balance: cb("USDC", "ARC") },
          { name: "Base", tag: "BASE", logo: require("@/assets/images/base logo.png"), balance: cb("USDC", "BASE") },
          { name: "Solana", tag: "SOL", logo: require("@/assets/images/solana.png"), balance: cb("USDC", "SOL") },
          { name: "BNB Chain", tag: "BEP20", logo: require("@/assets/images/bsc logo.png"), balance: cb("USDC", "BEP20") },
          { name: "Stellar", tag: "STELLAR", logo: require("@/assets/images/stellar.jpg"), balance: cb("USDC", "STELLAR") },
          { name: "Monad", tag: "MONAD", logo: require("@/assets/images/monad.png"), balance: cb("USDC", "MONAD") },
        ],
        chainLogos: [
          require("@/assets/images/movementnew.jpg"),
          require("@/assets/images/base logo.png"),
          require("@/assets/images/solana.png"),
          require("@/assets/images/bsc logo.png"),
        ],
      },
      {
        symbol: "USDT", total: usdtBalance, decimals: 2,
        chains: [
          { name: "Movement", tag: "MOVE", logo: require("@/assets/images/movementnew.jpg"), balance: cb("USDT", "MOVE") },
          { name: "Base", tag: "BASE", logo: require("@/assets/images/base logo.png"), balance: cb("USDT", "BASE") },
          { name: "Solana", tag: "SOL", logo: require("@/assets/images/solana.png"), balance: cb("USDT", "SOL") },
          { name: "BNB Chain", tag: "BEP20", logo: require("@/assets/images/bsc logo.png"), balance: cb("USDT", "BEP20") },
          { name: "TON", tag: "TON", logo: require("@/assets/images/toncoin.png"), balance: cb("USDT", "TON") },
          { name: "Stellar", tag: "STELLAR", logo: require("@/assets/images/stellar.jpg"), balance: cb("USDT", "STELLAR") },
          { name: "Monad", tag: "MONAD", logo: require("@/assets/images/monad.png"), balance: cb("USDT", "MONAD") },
        ],
        chainLogos: [
          require("@/assets/images/movementnew.jpg"),
          require("@/assets/images/base logo.png"),
          require("@/assets/images/solana.png"),
          require("@/assets/images/bsc logo.png"),
          require("@/assets/images/toncoin.png"),
        ],
      },
      {
        // Legacy bridged USDC.e — Movement only. Stands alone now that native
        // USDC (USDCx) carries the Movement slot in the USDC group above.
        symbol: "USDCe", total: cb("USDC", "MOVE"), decimals: 2,
        chains: [
          { name: "Movement", tag: "MOVE", logo: require("@/assets/images/movementnew.jpg"), balance: cb("USDC", "MOVE") },
        ],
        chainLogos: [
          require("@/assets/images/movementnew.jpg"),
        ],
      },
      {
        symbol: "MOVE", total: moveBalance, decimals: 2,
        chains: [
          { name: "Movement", tag: "MOVE", logo: require("@/assets/images/movementnew.jpg"), balance: cb("MOVE", "MOVE") },
        ],
        chainLogos: [
          require("@/assets/images/movementnew.jpg"),
        ],
      },
      {
        symbol: "SOL", total: solBalance, decimals: 4,
        chains: [
          { name: "Solana", tag: "SOL", logo: require("@/assets/images/solana.png"), balance: cb("SOL", "SOL") },
        ],
        chainLogos: [
          require("@/assets/images/solana.png"),
        ],
      },
      {
        // A naira stablecoin, so whole units the way naira are counted rather
        // than the four places a dollar token needs to say anything.
        symbol: "cNGN", total: cb("cNGN", "BASE") + cb("cNGN", "BEP20"), decimals: 2,
        chains: [
          { name: "Base", tag: "BASE", logo: require("@/assets/images/base logo.png"), balance: cb("cNGN", "BASE") },
          { name: "BNB Chain", tag: "BEP20", logo: require("@/assets/images/bsc logo.png"), balance: cb("cNGN", "BEP20") },
        ],
        chainLogos: [
          require("@/assets/images/base logo.png"),
          require("@/assets/images/bsc logo.png"),
        ],
      },
    ];

    /**
     * Zero at the precision it is written at.
     *
     * A balance is not empty because it is zero, it is empty because there is
     * nothing left to say about it. Sweeping floors to eight places rather than
     * rounding - deliberately, since asking a token contract for more than the
     * balance reverts - so it leaves a few billionths behind every time. Those
     * are greater than zero and print as 0.00, which is how BNB Chain went on
     * being listed under USDT after the sweep had taken everything.
     *
     * The row decides at the precision it renders. If it would print as zero,
     * it is not there.
     */
    const holds = holdsAt;

    /**
     * USDCe and SOL are hidden while empty.
     *
     * Neither is something anyone sets out to hold: USDCe is the legacy bridged
     * USDC.e kept only so old balances remain reachable, and SOL is really
     * there to pay Solana fees. Listing both at 0.00 padded the list with rows
     * that never do anything.
     *
     * Hidden while empty rather than removed - a real balance in either still
     * appears, so this cannot quietly swallow someone's money.
     */
    const HIDE_WHEN_EMPTY = new Set(["USDCe", "SOL"]);
    const visible = tokens.filter(
      (t) => !(HIDE_WHEN_EMPTY.has(t.symbol) && !holds(t.total, t.decimals)),
    );

    /**
     * USDC first, USDT under it, then everything else by what it is worth.
     *
     * The two dollar stablecoins are what this wallet is for, and they are a
     * pair - people read one against the other. Sorting purely by value split
     * them the moment a USDT balance emptied, dropping it below whatever naira
     * or MOVE happened to be sitting there, so the row somebody was looking for
     * moved about depending on what they had just spent.
     *
     * Pinned rather than hidden: an empty USDT row is still where you send
     * USDT to, and a list that only shows what you already hold cannot tell
     * you where to put anything new.
     *
     * USDCe stays last whatever it holds - it is the legacy bridged balance,
     * kept reachable rather than offered.
     */
    const PINNED = ["USDC", "USDT"];
    const rank = (sym: string) => {
      if (sym === "USDCe") return PINNED.length + 1;
      const i = PINNED.indexOf(sym);
      return i === -1 ? PINNED.length : i;
    };

    const usdRate = (sym: string): number => (rates as any)?.[sym]?.usd || 0;

    /**
     * Inside a token, the chain holding the most comes first.
     *
     * The order was written down once and stayed that way, so somebody with 23
     * on Arc and 5 on Movement was shown Movement at the top - the list read as
     * a ranking and ranked the wrong thing. Where the money is answers the
     * question people open this to ask.
     *
     * The deposit picker keeps its own fixed order on purpose: that one is
     * "which network do you want", and it should not shuffle under somebody
     * between visits.
     */
    const byHolding = visible.map((t) => ({
      ...t,
      chains: t.chains.slice().sort((x, y) => y.balance - x.balance),
    }));

    return byHolding.slice().sort((a, b) => {
      const byRank = rank(a.symbol) - rank(b.symbol);
      if (byRank !== 0) return byRank;
      return (b.total * usdRate(b.symbol)) - (a.total * usdRate(a.symbol));
    });
  }, [usdcBalance, usdtBalance, usdcxBalance, moveBalance, solBalance, walletBalances, rates]);

  const formatNaira = (amount: number) => {
    const parts = amount.toFixed(2).split(".");
    const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return { whole, decimal: parts[1] };
  };

  /**
   * Which unit the balance is shown in.
   *
   * Re-read on focus rather than once on mount: the setting lives on the
   * Account tab, so the only way back here is a focus event.
   */
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("NGN");
  useFocusEffect(
    useCallback(() => {
      getDisplayCurrency().then(setDisplayCurrencyState);
    }, []),
  );

  const showUsd = displayCurrency === "USD";
  // Same formatter either way - it only ever split a number into whole and
  // decimal parts; the naira was in the name, not the maths.
  const bal = formatNaira(showUsd ? usdBalance : ngnBalance ?? 0);

  const copyId = () => {
    try { Clipboard.setString(user?.username || ""); } catch {}
    Alert.alert("Copied", "ID copied to clipboard");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 124 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >

        {/* Header: who you are on the left, utilities right, rule underneath.
            "Home" named the tab you had just tapped; the greeting says
            something the screen does not otherwise state. */}
        <View style={[styles.pageHeader, { paddingTop: topPad + 4 }]}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]} numberOfLines={1}>
            Hello, {user?.username || "there"}
          </Text>
          <View style={styles.pageHeaderIcons}>
            <TouchableOpacity onPress={() => router.push("/notifications")} style={{ position: "relative" }}>
              <Image
                source={require("@/assets/images/bell.png")}
                style={[styles.headerIcon, { tintColor: colors.foreground }]}
              />
              {unreadNotifs > 0 && (
                <View style={[styles.headerDot, { backgroundColor: colors.destructive }]} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/account/support" as any)}>
              <Image
                source={require("@/assets/images/support.png")}
                style={[styles.headerIcon, { tintColor: colors.foreground }]}
              />
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.pageRule, { backgroundColor: colors.border }]} />

        {/* Balance, on the background rather than in a card. The card was
            competing with the number; the number is the point. */}
        <View style={styles.balanceBlock}>
          {/* hitSlop because the row is only as tall as its 11pt caption: a tap
              aimed at the eye landed outside the touchable more often than not,
              so only the words appeared to work. */}
          <TouchableOpacity
            style={styles.balanceLabelRow}
            onPress={() => setBalanceHidden(!balanceHidden)}
            activeOpacity={0.7}
            hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
          >
            <Text style={[styles.balanceCaption, { color: colors.mutedForeground }]}>
              TOTAL BALANCE
            </Text>
            <Image
              source={
                balanceHidden
                  ? require("@/assets/images/hidden.png")
                  : require("@/assets/images/eye.png")
              }
              style={[styles.balanceEye, { tintColor: colors.mutedForeground }]}
            />
          </TouchableOpacity>

          {/* The naira mark is artwork, not a character: Inter's glyph varies
              across platforms and its sidebearings fight the negative tracking
              the digits need. As an image it is sized and spaced on its own
              terms. */}
          {balancesLoading && !balanceHidden ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.balanceSpinner} />
          ) : balanceHidden ? (
            <Text style={[styles.balanceBig, { color: colors.foreground }]}>••••••</Text>
          ) : (
            <View style={styles.balanceRow}>
              {showUsd ? (
                <Text style={[styles.balanceBig, styles.dollarMark, { color: colors.foreground }]}>$</Text>
              ) : (
                <Image
                  source={require("@/assets/images/nairaiconnew.png")}
                  style={[styles.nairaMark, { tintColor: colors.foreground }]}
                />
              )}
              <Text style={[styles.balanceBig, { color: colors.foreground }]} numberOfLines={1}>
                {bal.whole}
                <Text style={[styles.balanceBigDecimal, { color: colors.mutedForeground }]}>.{bal.decimal}</Text>
              </Text>
            </View>
          )}

          {/* The dollar equivalent lived here and is off for now - it is going
              somewhere else. `usdBalance` above still computes it, so putting it
              back is a matter of rendering it again. */}
        </View>

        {/* One row of circular actions. The last is filled, so the row has a
            primary action rather than four equal ones. */}
        <View style={styles.actionsRow}>
          {ACTIONS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.actionItem}
              activeOpacity={0.7}
              onPress={() => {
                setSheetPaused(null);
                if (item.sheet) return setShowDepositSheet(true);
                if (item.sendSheet) return setShowSendSheet(true);
                requireWallet(() => router.push(item.route as any));
              }}
            >
              <View
                style={[
                  styles.actionCircle,
                  item.solid
                    ? { backgroundColor: colors.primary }
                    // A brighter rim than colors.border. That token is tuned for
                    // dividers inside a list, where it should barely register -
                    // here it is the entire shape of a button, and at that weight
                    // the circles read as smudges rather than as edges.
                    : { borderColor: colors.foreground + "3D", borderWidth: 1.5 },
                ]}
              >
                {item.image ? (
                  <Image
                    source={item.image}
                    style={[
                      styles.actionImage,
                      item.imageSize ? { width: item.imageSize, height: item.imageSize } : null,
                      { tintColor: item.solid ? colors.primaryForeground : colors.foreground },
                    ]}
                  />
                ) : (
                  <Feather
                    name={item.icon!}
                    size={19}
                    color={item.solid ? colors.primaryForeground : colors.foreground}
                  />
                )}
              </View>
              <Text style={[styles.actionLabel, { color: colors.foreground }]} numberOfLines={1}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.sectionSplit, { backgroundColor: colors.border }]} />

        {/* Wallet Banner */}
        {!walletReady && hasWallet && walletSkipped && (
          <TouchableOpacity
            style={[styles.walletBanner, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowWalletRecovery(true)}
            activeOpacity={0.7}
          >
            <View style={styles.walletBannerContent}>
              <Feather name="shield" size={28} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.walletBannerTitle, { color: colors.foreground }]}>
                  Restore Your Wallet
                </Text>
                <Text style={[styles.walletBannerDesc, { color: colors.mutedForeground }]}>
                  Tap here to restore your wallet on this device
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
            </View>
          </TouchableOpacity>
        )}

        {/* Backup Reminder Banner (non-blocking) */}
        {showBackupBanner && (
          <TouchableOpacity
            style={[styles.walletBanner, { backgroundColor: "#FFF8E1", borderColor: "#FFD54F" }]}
            onPress={() => { setShowBackupBanner(false); setShowWalletSetup(true); }}
            activeOpacity={0.7}
          >
            <View style={styles.walletBannerContent}>
              <Feather name="upload-cloud" size={28} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.walletBannerTitle, { color: "#92400E" }]}>
                  Back Up Your Wallet
                </Text>
                <Text style={[styles.walletBannerDesc, { color: "#B45309" }]}>
                  Protect your funds — back up your recovery phrase now
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setShowBackupBanner(false); AsyncStorage.setItem(backupKey, "skipped"); }}>
                <Feather name="x" size={20} color="#92400E" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {/* Trading Competition Card */}
        {showCompCard && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() =>
              router.push({ pathname: "/leaderboard", params: { initialTab: "events" } })
            }
            style={styles.compCardWrap}
          >
            <LinearGradient
              colors={["#0a3d1f", "#1a6b3a", "#4a9c2a"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.compCard}
            >
              <View style={styles.compCardGlow} />

              <TouchableOpacity
                onPress={dismissCompCard}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                style={styles.compCloseBtn}
              >
                <Feather name="x" size={14} color="rgba(255,255,255,0.85)" />
              </TouchableOpacity>

              {compStatus === "live" && (
                <View style={[styles.compStatusPill, styles.compStatusPillLive]}>
                  <View style={styles.compLiveDot} />
                  <Text style={styles.compStatusText}>LIVE</Text>
                </View>
              )}

              <Text style={styles.compCardTitle}>
                <Text style={styles.compCardPrize}>₦110K</Text> Trading Competition
              </Text>
              <Text style={styles.compCardSub}>
                {compStatus === "live"
                  ? "Live now · trade Fund & Sell to climb the board"
                  : "Sun 24 May → Sat 6 Jun · Top traders win cash"}
              </Text>

              <View style={styles.compCardCta}>
                <Text style={styles.compCardCtaText}>View Leaderboard</Text>
                <Feather name="arrow-right" size={13} color="#81FB02" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Section bar: which list, and a way out to the full one.
            Kept as two switchable labels rather than the reference's single
            heading - the reference has no asset list to show, and dropping the
            toggle would stand the token balances down entirely. */}
        <View style={styles.sectionBar}>
          <View style={styles.sectionTabs}>
            {(["transactions", "wallet"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setHomeTab(t)}
                activeOpacity={0.7}
                style={styles.sectionTab}
                hitSlop={{ top: 6, bottom: 6 }}
              >
                <Text
                  style={[
                    styles.sectionCaption,
                    { color: t === homeTab ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {t === "wallet" ? "ASSETS" : "TRANSACTIONS"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => router.push(homeTab === "wallet" ? "/select-crypto" : "/transactions")}
            activeOpacity={0.7}
            style={styles.viewMoreBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {/* Named for where it goes. Over the asset list it opens Add money,
                which is a deposit and not more of the list you are looking at -
                "View more" beside your holdings reads as the rest of them. */}
            <Text style={[styles.viewMoreText, { color: colors.primary }]}>
              {homeTab === "wallet" ? "Deposit" : "View more"}
            </Text>
            <Feather name="chevron-right" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {homeTab === "wallet" ? (
          <View style={styles.txSection}>
            {/* The value, flat on the page. A card around it only drew a box
                around the one thing on this screen that needs no help being
                found. */}
            <View style={[styles.portfolioHead, styles.portfolioRow]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                {balancesLoading && !balanceHidden ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} style={{ height: 46, alignSelf: "flex-start" }} />
                ) : (
                  <Text style={[styles.portfolioValue, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
                    {balanceHidden
                      ? "••••••"
                      : `$${usdBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </Text>
                )}
              </View>

              {/* A tag, not a banner. It belongs to the figure it sits beside -
                  scattered balances are what that figure is made of - and a
                  full-width card for an optional tidy-up outranked the token
                  rows it is about. The detail lives in the sheet. */}
              {(canSweep || swapOn) && (
                /* Buttons, not glowing pills: the screen's own surface, the
                   text colour for both the glyph and the word. The figure
                   beside them is the headline. */
                <View style={styles.tagRow}>
                  {swapOn && (
                    <TouchableOpacity
                      style={[styles.tagBtn, { backgroundColor: colors.card }]}
                      activeOpacity={0.6}
                      onPress={() => router.push("/swap" as any)}
                      hitSlop={{ top: 8, bottom: 8 }}
                    >
                      <Feather name="repeat" size={14} color={colors.foreground} />
                      <Text style={[styles.tagText, { color: colors.foreground }]}>Swap</Text>
                    </TouchableOpacity>
                  )}
                  {canSweep && (
                    <TouchableOpacity
                      style={[styles.tagBtn, { backgroundColor: colors.card }]}
                      activeOpacity={0.6}
                      onPress={() => router.push("/sweep" as any)}
                      hitSlop={{ top: 8, bottom: 8 }}
                    >
                      <MaterialCommunityIcons name="broom" size={16} color={colors.foreground} />
                      <Text style={[styles.tagText, { color: colors.foreground }]}>Sweep</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Two headings instead of a bar. Three neon segments at falling
                opacity had nothing keying a segment back to a row, so the
                split was decoration - the share is a figure in a column now,
                where it can be read against the one above it. */}
            <View style={styles.ledgerHead}>
              <Text style={[styles.ledgerCap, { color: colors.mutedForeground }]}>HOLDING</Text>
              <Text style={[styles.ledgerCap, { color: colors.mutedForeground }]}>SHARE</Text>
            </View>

            {walletTokens.map((tok) => {
              const isExpanded = expandedToken === tok.symbol;
              /**
               * No rate, no value.
               *
               * This fell back to `?? 1`, which valued anything unpriced as a
               * dollar: 1,800 cNGN showed as $1,800 and took a 13,292% share
               * of a $13.54 portfolio. The two USDC variants are the only
               * things that legitimately borrow another asset's price, and
               * they borrow it by name rather than by defaulting to par.
               */
              const rateKey =
                tok.symbol === "USDCe" || tok.symbol === "USDCx" ? "USDC" : tok.symbol;
              const usd = tok.total * (Number((rates as any)?.[rateKey]?.usd) || 0);
              const share = usdBalance > 0 ? (usd / usdBalance) * 100 : 0;
              return (
                <View key={tok.symbol}>
                  <TouchableOpacity
                    style={styles.assetRow}
                    activeOpacity={tok.chains.length > 1 ? 0.7 : 1}
                    disabled={tok.chains.length <= 1}
                    onPress={() => setExpandedToken(isExpanded ? null : tok.symbol)}
                  >
                    <TokenLogo symbol={tok.symbol} size={40} dark />

                    <View style={styles.assetInfo}>
                      <Text style={[styles.assetSymbol, { color: colors.foreground }]}>
                        {tok.symbol}
                      </Text>
                      {/* Only the chains holding something, named.
                          Marks read as one object - where this holding lives -
                          but they need to be known before they mean anything,
                          and four dark discs at 17 points is a lot to ask of
                          someone who has not learned them yet. The names
                          answer without being learned.

                          A chain at zero is left out entirely. Where a token
                          *can* go is not a fact about your money - and zero
                          means zero at the precision this row prints, so the
                          billionths a sweep leaves behind do not keep a chain
                          named here either. */}
                      <Text
                        style={[styles.assetChainNames, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {tok.chains.some((c) => listsAt(c, tok.decimals))
                          ? tok.chains
                              .filter((c) => listsAt(c, tok.decimals))
                              .map((c) => c.name)
                              .join(" \u00B7 ")
                          : "No asset"}
                      </Text>
                    </View>

                    <View style={styles.assetAmounts}>
                      {balancesLoading && !balanceHidden ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <>
                          <Text style={[styles.assetBal, { color: colors.foreground }]}>
                            {balanceHidden ? "••••" : tok.total.toFixed(tok.decimals)}
                          </Text>
                          {/* Two lines on every row, never three: the dollar
                              value and the share share the second one. Shown on
                              every holding, stablecoins included - reading the
                              same figure twice costs nothing next to having to
                              work out which rows were left off and why. */}
                          <Text style={styles.assetShare}>
                            {!balanceHidden && usd > 0 && (
                              <Text style={{ color: colors.mutedForeground }}>
                                {`$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · `}
                              </Text>
                            )}
                            <Text style={{ color: colors.primary }}>
                              {balanceHidden ? "•••" : `${share.toFixed(0)}%`}
                            </Text>
                          </Text>
                        </>
                      )}
                    </View>

                    {/* Fixed slot, so rows with nothing to open still line up
                        with those that do. */}
                    <View style={styles.assetChevron}>
                      {tok.chains.length > 1 && (
                        <Feather
                          name={isExpanded ? "chevron-up" : "chevron-down"}
                          size={15}
                          color={colors.mutedForeground}
                        />
                      )}
                    </View>
                  </TouchableOpacity>

                  {/* A row each, with the chain spelled out. The marks above
                      say which chains a holding sits on; this says how much on
                      each, and a name is what turns a mark into an answer.

                      Only the chains holding something. Four rows of 0.00 is
                      four answers to a question nobody asked - opening a row
                      is asking where the money is, and a chain with none of it
                      is not part of that answer. A token pinned to the list
                      while empty can open on nothing at all, so that says so
                      in words rather than showing an empty box. */}
                  {isExpanded && (
                    <View style={styles.chainBreakdown}>
                      {!tok.chains.some((c) => listsAt(c, tok.decimals)) && (
                        <Text style={[styles.chainBalEmpty, { color: colors.mutedForeground }]}>
                          No asset
                        </Text>
                      )}
                      {tok.chains.filter((c) => listsAt(c, tok.decimals)).map((chain) => (
                        <View key={chain.tag} style={styles.chainBalRowNew}>
                          <Image
                            source={chain.logo}
                            style={[styles.chainBalLogo, chain.tag === "ARB" && { borderRadius: 0, transform: [{ scale: 1.2 }] }]}
                            resizeMode="cover"
                          />
                          <Text style={[styles.chainBalName, { color: colors.mutedForeground }]} numberOfLines={1}>
                            {chain.name}
                          </Text>
                          <Text
                            style={[styles.chainBalAmount, { color: colors.foreground }]}
                            numberOfLines={1}
                          >
                            {balanceHidden ? "••••" : chain.balance.toFixed(tok.decimals)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.txSection}>
            {/* No heading here - the section bar above already names the list
                and carries the way out to the full one. */}
            {recentTx.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions yet</Text>
            ) : (
              recentTx.map((tx) => (
                  <TransactionItem
                    key={tx.id}
                    type={tx.type}
                    asset={tx.asset || "USDC"}
                    chain={tx.chain}
                    amount={Number(tx.amount)}
                    status={tx.status}
                    createdAt={tx.createdAt}
                    metadata={tx.metadata}
                    onPress={() => router.push({ pathname: "/transactions/detail", params: { id: tx.id } })}
                  />
              ))
            )}

            {/* The way through to the rest, at the end of the list where you
                run out rather than only in the header where you start. Hidden
                when there is nothing past what is already shown. */}
            {transactions.length > recentTx.length && (
              <TouchableOpacity
                style={styles.viewMoreRow}
                onPress={() => router.push("/transactions")}
                activeOpacity={0.7}
              >
                <Text style={[styles.viewMoreRowText, { color: colors.mutedForeground }]}>
                  View more transactions
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Outside the scroller and above the tab bar: it floats over the list
          rather than pushing it, so nothing on the page moves when an update
          lands. Home only - it is the one screen where nothing is
          half-finished, and a reload during a signature would be the worst
          moment there is. */}
      <UpdateStub />

      {/* Deposit, as a card that floats clear of the edges.
          Backdrop blurs rather than dims: the home screen stays legible behind
          it, which keeps this a step taken on top of where you already are. The
          modal fades so the blur does not slide, and the card carries its own
          entrance. */}
      {showDepositSheet && (
        <Modal transparent animationType="fade" visible statusBarTranslucent
          onRequestClose={() => setShowDepositSheet(false)}
        >
          <Pressable style={styles.sheetOverlay} onPress={() => setShowDepositSheet(false)}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              // Android has no real backdrop blur; a dim is the honest fallback.
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.62)" }]} />
            )}
          </Pressable>

          <View style={styles.sheetDock} pointerEvents="box-none">
            <Reanimated.View
              entering={SlideInDown.duration(260)}
              exiting={SlideOutDown.duration(200)}
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  marginBottom: (insets.bottom || 12) + 10,
                },
              ]}
            >
              <Pressable onPress={(e) => e.stopPropagation()}>
                {sheetPaused ? (
                  <PausedCard detail={pausedDetail(sheetPaused)} onClose={() => setSheetPaused(null)} />
                ) : (
                  <>
                    <View style={styles.sheetHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add money</Text>
                        <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                          Choose how to fund your wallet
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setShowDepositSheet(false)}
                        style={[styles.sheetClose, { backgroundColor: colors.muted }]}
                        hitSlop={10}
                      >
                        <Feather name="x" size={17} color={colors.foreground} />
                      </TouchableOpacity>
                    </View>

                    {/* Side by side, because the two are alternatives rather than a
                        list to read down - and two chevrons pointing at two rows of
                        the same weight told you nothing about which to take. */}
                    <View style={styles.depoGrid}>
                      {DEPOSIT_METHODS.map((m) => {
                        const off = !!m.service && svc.paused(m.service);
                        const note = m.service ? svc.detail(m.service)?.note?.trim() : null;

                        return (
                          <TouchableOpacity
                            key={m.label}
                            style={[styles.depoTile, { backgroundColor: colors.muted }]}
                            activeOpacity={0.75}
                            onPress={() => {
                              if (off && m.service) {
                                setSheetPaused(m.service);
                                return;
                              }
                              setShowDepositSheet(false);
                              requireWallet(() => router.push(m.route as any));
                            }}
                          >
                            <View
                              style={[
                                styles.methodIcon,
                                { backgroundColor: (off ? colors.warning : colors.primary) + "18" },
                              ]}
                            >
                              <Image
                                source={m.image}
                                style={[
                                  styles.methodImg,
                                  { tintColor: off ? colors.warning : colors.primary },
                                ]}
                              />
                            </View>
                            <Text
                              style={[
                                styles.depoTitle,
                                { color: off ? colors.mutedForeground : colors.foreground },
                              ]}
                            >
                              {m.label}
                            </Text>
                            <Text
                              style={[
                                styles.depoSub,
                                { color: off ? colors.warning : colors.mutedForeground },
                              ]}
                              numberOfLines={1}
                            >
                              {off ? note || PAUSED_NOTE : m.sub}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
              </Pressable>
            </Reanimated.View>
          </View>
        </Modal>
      )}

      {showSendSheet && (
        <Modal transparent animationType="fade" visible statusBarTranslucent
          onRequestClose={() => setShowSendSheet(false)}
        >
          <Pressable style={styles.sheetOverlay} onPress={() => setShowSendSheet(false)}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.62)" }]} />
            )}
          </Pressable>

          <View style={styles.sheetDock} pointerEvents="box-none">
            <Reanimated.View
              entering={SlideInDown.duration(260)}
              exiting={SlideOutDown.duration(200)}
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  marginBottom: (insets.bottom || 12) + 10,
                },
              ]}
            >
              <Pressable onPress={(e) => e.stopPropagation()}>
                {sheetPaused ? (
                  <PausedCard detail={pausedDetail(sheetPaused)} onClose={() => setSheetPaused(null)} />
                ) : (
                  <>
                    <View style={[styles.sendGrip, { backgroundColor: colors.border }]} />

                    <View style={styles.sendHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.sendHeading, { color: colors.foreground }]}>Send money</Text>
                        <Text style={[styles.sendHeadSub, { color: colors.mutedForeground }]}>
                          Choose where it is going
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setShowSendSheet(false)}
                        style={[styles.sheetClose, { backgroundColor: colors.muted }]}
                        hitSlop={10}
                      >
                        <Feather name="x" size={17} color={colors.foreground} />
                      </TouchableOpacity>
                    </View>

                    {/* Ruled rows, no tiles. A tinted rounded square behind every
                        icon is the thing that made three different destinations
                        look like three of the same object; the mark alone carries
                        it, and the brand colour is then the only accent on the
                        sheet rather than one of four. */}
                    {SEND_METHODS.map((m, i) => {
                      const off = !!m.service && svc.paused(m.service);
                      const note = m.service ? svc.detail(m.service)?.note?.trim() : null;

                      return (
                        <TouchableOpacity
                          key={m.label}
                          style={[
                            styles.sendRow,
                            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                          ]}
                          activeOpacity={0.6}
                          onPress={() => {
                            if (off && m.service) {
                              setSheetPaused(m.service);
                              return;
                            }
                            setShowSendSheet(false);
                            requireWallet(() => router.push(m.route as any));
                          }}
                        >
                          {/* The mark is the only colour on this sheet, so losing
                              its tint is what reads as off - before any word does. */}
                          <Image
                            source={m.image}
                            style={[
                              styles.sendMark,
                              { tintColor: off ? colors.mutedForeground : colors.primary },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.sendTitle,
                                { color: off ? colors.mutedForeground : colors.foreground },
                              ]}
                            >
                              {m.label}
                            </Text>
                            <Text
                              style={[
                                styles.sendSub,
                                { color: off ? colors.warning : colors.mutedForeground },
                              ]}
                              numberOfLines={1}
                            >
                              {off ? note || PAUSED_NOTE : m.sub}
                            </Text>
                          </View>
                          {/* The chip is already the slot that says this row goes
                              somewhere, so it is the one that says otherwise.
                              Swapping the glyph inside holds the column in place. */}
                          <View
                            style={[
                              styles.sendGo,
                              { backgroundColor: off ? colors.warning + "26" : colors.muted },
                            ]}
                          >
                            <Feather
                              name={off ? "pause" : "chevron-right"}
                              size={off ? 13 : 16}
                              color={off ? colors.warning : colors.mutedForeground}
                            />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </Pressable>
            </Reanimated.View>
          </View>
        </Modal>
      )}

      {/* Wallet-type chooser — first setup (or after an admin wallet reset).
          Only when the user is verified, has no wallet, and hasn't chosen yet. */}
      <WalletTypeChooser
        visible={
          !!user?.loginVerified &&
          !walletReady &&
          !hasWallet &&
          walletType === null &&
          !walletSkipped
        }
        onDone={() => {}}
      />

      {/* Wallet Backup Prompt */}
      <WalletSetupModal
        visible={showWalletSetup}
        onComplete={() => {
          setShowWalletSetup(false);
          AsyncStorage.setItem(backupKey, "true");
        }}
        onSkip={() => {
          setShowWalletSetup(false);
          setWalletSkipped(true);
        }}
      />

      {/* Wallet Recovery Modal */}
      <WalletRecoveryModal
        visible={showWalletRecovery}
        onComplete={async () => {
          setShowWalletRecovery(false);
          // Block the useEffect from re-showing the modal while connectWallet runs
          setWalletSkipped(true);
          try {
            await connectWallet();
            await refreshBalances();
            setWalletRestoredMsg(true);
            Animated.timing(toastOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start(() => {
              setTimeout(() => {
                Animated.timing(toastOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setWalletRestoredMsg(false));
              }, 2500);
            });
          } catch {}
          // Wallet is now ready — walletReady=true will prevent the modal from re-appearing
          setWalletSkipped(false);
        }}
        onCancel={() => {
          setShowWalletRecovery(false);
          setWalletSkipped(true);
        }}
        /**
         * There is no "create a new one" any more.
         *
         * It called connectWallet, which minted a 12-word wallet - so somebody
         * whose email wallet had not arrived could tap once and end up with a
         * second wallet of the kind we no longer support, holding the address
         * money then went to.
         */
        onCreateNew={async () => {
          setShowWalletRecovery(false);
          setWalletSkipped(true);
          Alert.alert(
            "Sign in to get your wallet",
            "New wallets come with your email sign-in now — there is nothing to create here. " +
              "If you already have a 12-word phrase, use Restore instead.",
          );
        }}
      />

      {/* Wallet unavailable — themed sheet (a native Alert truncated the reason
          and rendered awkwardly). Shows the real error and offers a retry. */}
      {showWalletErrorSheet && (
        <Modal transparent animationType="slide" visible statusBarTranslucent>
          <View style={styles.dialogOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowWalletErrorSheet(false)}
            />
            <View style={[styles.dialogCard, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.dialogHandle} />
              <Feather name="alert-triangle" size={44} color={colors.primary} style={{ marginBottom: 16 }} />
              <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
                Wallet unavailable
              </Text>
              <Text style={[styles.dialogSubtitle, { color: colors.mutedForeground }]}>
                {walletError
                  ? "We couldn't finish setting up your wallet."
                  : "Your wallet is still being set up. Give it a moment and try again."}
              </Text>
              {!!walletError && (
                <View style={[styles.errBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.errBoxText, { color: colors.mutedForeground }]}>
                    {walletError}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: colors.primary, opacity: walletRetrying ? 0.7 : 1 }]}
                disabled={walletRetrying}
                onPress={async () => {
                  setWalletRetrying(true);
                  try {
                    await retryWalletSetup();
                    setShowWalletErrorSheet(false);
                  } catch {
                    // walletError is updated by the context; keep the sheet open.
                  } finally {
                    setWalletRetrying(false);
                  }
                }}
                activeOpacity={0.85}
              >
                {walletRetrying ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.dialogBtnText, { color: colors.primaryForeground }]}>
                    Try again
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.dialogSkip} onPress={() => setShowWalletErrorSheet(false)}>
                <Text style={[styles.dialogSkipText, { color: colors.foreground }]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Returning from the old app: what changed, then the usual first-run
          sequence. It goes first because the rest makes no sense without it. */}
      <WelcomeBackSheet
        visible={showWelcomeBack}
        onExportWallet={() => {
          setShowWelcomeBack(false);
          if (user?.id) {
            AsyncStorage.setItem(`mm_welcome_v2_${user.id}`, "1").catch(() => {});
          }
          router.push("/account/export-wallet" as any);
        }}
        onDone={() => {
          setShowWelcomeBack(false);
          if (user?.id) {
            AsyncStorage.setItem(`mm_welcome_v2_${user.id}`, "1").catch(() => {});
          }
          // What comes next - the referral prompt or verification - is
          // decided by the arrival effect, which re-runs as this closes.
        }}
      />

      {/* Username sheet — first-run, editable, skippable. Then chains to KYC. */}
      <UsernameSheet
        visible={showUsernameSheet}
        initialUsername={user?.username || ""}
        onDone={() => {
          setShowUsernameSheet(false);
          // Marked against this account, whether they picked a name or skipped.
          if (user?.id) {
            AsyncStorage.setItem(`mm_username_prompted_${user.id}`, "1").catch(() => {});
          }
          // Hands on to the arrival effect, which re-runs as this closes and
          // opens the next popup - still one at a time, still once a day for
          // verification.
        }}
      />

      {showKycSheet && (
        <Modal transparent animationType="slide" visible={showKycSheet} statusBarTranslucent>
          <View style={styles.dialogOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowKycSheet(false)}
            />
            <View
              style={[
                styles.dialogCard,
                { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
              ]}
            >
              <View style={styles.dialogHandle} />
              <TouchableOpacity
                style={[styles.dialogClose, { backgroundColor: colors.muted }]}
                onPress={() => setShowKycSheet(false)}
                hitSlop={8}
              >
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              <Image
                source={require("@/assets/images/id-card.png")}
                style={[styles.kycBadgeImg, { tintColor: colors.primary }]}
                resizeMode="contain"
              />
              <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
                Complete your KYC
              </Text>
              <Text style={[styles.dialogSubtitle, { color: colors.mutedForeground }]}>
                Verify your account and enjoy higher spending limits
              </Text>

              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: colors.primary }]}
                onPress={() => { setShowKycSheet(false); router.push("/account/kyc"); }}
                activeOpacity={0.85}
              >
                <Text style={[styles.dialogBtnText, { color: colors.primaryForeground }]}>
                  Verify your Account
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.dialogSkip} onPress={() => setShowKycSheet(false)}>
                <Text style={[styles.dialogSkipText, { color: colors.foreground }]}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* ── Did a friend invite you? Once per account, ever ── */}
      {showRefSheet && (
        <ReferralPromptSheet bottomInset={insets.bottom} onClose={() => setShowRefSheet(false)} />
      )}

      {/* ── Alerts when the app is closed. Android, once per phone ── */}
      {showBgSheet && (
        <BackgroundAlertsSheet bottomInset={insets.bottom} onClose={() => setShowBgSheet(false)} />
      )}

      {/* ── A business asking to be paid into this account ──
          Behind its own boundary: if the sheet ever fails, it stays away for
          this run (the request still waits in Security) instead of taking
          Home down with it. */}
      {linkSheetUp && (
        <ErrorBoundary
          FallbackComponent={NoSheet}
          onError={() => {
            linkRequests.forEach((l) => heldBack.current.add(l.id));
            setLinkRequests([]);
          }}
        >
          <BusinessLinkSheet
            requests={linkRequests}
            username={user?.username}
            bottomInset={insets.bottom}
            onAnswered={(id) => setLinkRequests((cur) => cur.filter((l) => l.id !== id))}
            onLater={() => {
              linkRequests.forEach((l) => heldBack.current.add(l.id));
              setLinkRequests([]);
            }}
          />
        </ErrorBoundary>
      )}

      {/* Wallet Restored Toast */}
      {walletRestoredMsg && (
        <Animated.View style={[styles.successToast, { opacity: toastOpacity }]}>
          <Feather name="check-circle" size={22} color="#fff" />
          <Text style={styles.successToastText}>Wallet restored successfully</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Wallet Banner */
  walletBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  walletBannerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  walletBannerTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  walletBannerDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  walletBannerBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  walletBannerBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },

  /* Success Toast */
  successToast: {
    position: "absolute",
    top: 60,
    left: 24,
    right: 24,
    backgroundColor: "#16A34A",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 10,
    zIndex: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  successToastText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  /* Balance Card */
  // ── Home layout ────────────────────────────────────────────
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  // Smaller than the old "Home": a name is longer than a word, and it has an
  // avatar beside it now.
  pageTitle: { flex: 1, marginRight: 12, fontSize: 19, lineHeight: 25, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  pageHeaderIcons: { flexDirection: "row", alignItems: "center", gap: 18 },
  headerIcon: { width: 21, height: 21, resizeMode: "contain" },
  /**
   * Sits on the bell rather than beside it.
   *
   * Hung off the corner at 8pt it read as a stray mark next to the icon; a
   * badge belongs on the shape it belongs to. Tucked inside the bounds and
   * small enough to be a state, not an element.
   */
  headerDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // Edge to edge. These two rules divide the screen into bands, and a rule
  // that stops short of the edge reads as belonging to the content beside it
  // rather than separating what is above from what is below.
  pageRule: { height: StyleSheet.hairlineWidth },

  balanceBlock: { alignItems: "center", paddingTop: 26, paddingBottom: 22 },
  balanceLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  balanceEye: { width: 15, height: 15, resizeMode: "contain" },
  balanceCaption: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.1,
  },
  // adjustsFontSizeToFit needs a height to shrink within, so the line height is
  // set rather than left to the font.
  balanceBig: {
    fontSize: 44,
    /**
     * Close to the font size. At 56 the line box carried about 12pt of empty
     * space under the number, which pushed everything below it away.
     *
     * That leading sat above the digits as well as below, so tightening it
     * pulled the caption down onto the number. The margin puts that gap back
     * deliberately, on the side where it is wanted.
     */
    lineHeight: 48,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.4,
    marginTop: 14,
  },
  /**
   * The symbol opts out of the balance's negative tracking.
   *
   * -1.4 is right for a run of digits but closes the gap after the naira mark
   * too, and its own sidebearings are already tight - so the 7 ends up touching
   * the strokes. A small positive value here restores the space without
   * loosening the number itself.
   */
  // Bottom-aligned, so the mark sits on the digits' baseline rather than on
  // the middle of their line box - centred, it floated against a figure
  // whose weight is all below the midline.
  balanceRow: { flexDirection: "row", alignItems: "flex-end" },
  /**
   * Sized against the digits, and pulled in against them.
   *
   * The box is not the mark. `contain` scales the whole PNG - its transparent
   * margin included - so the glyph only fills about two thirds of whatever
   * height is set here, and about 64% of the width. At 35 the glyph sits well
   * under the cap height of the 44pt digits, which is where a currency sign
   * belongs: present, not competing.
   *
   * That same invisible margin is why neither gap is the gap it looks like
   * in the stylesheet. The row gap is gone and the negative margins take back
   * part of the PNG's own padding before the digits. marginBottom works the
   * other way: flex-end puts the box bottom on the line box bottom, which is
   * below the baseline, and the glyph sits about 6pt above its own box
   * bottom - so a positive lift is what brings the glyph onto the baseline.
   */
  nairaMark: { width: 35 * FONT_SCALE, height: 35 * FONT_SCALE, resizeMode: "contain", marginRight: -3 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  // The dollar sign is a real character rather than artwork, so it only needs
  // nudging onto the same baseline the naira mark sits on.
  dollarMark: { marginRight: 2 },
  balanceBigDecimal: { fontSize: 26, lineHeight: 34, fontFamily: "Inter_700Bold" },
  balanceSpinner: { height: 48, marginTop: 14 },
  balanceSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },

  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    // Wider than the 20 the lists use. These four are a group and should read
    // as one, so they sit inside the page margin rather than stretching to it.
    paddingHorizontal: 36,
    paddingBottom: 26,
  },
  actionItem: { alignItems: "center", gap: 9, width: 72 },
  actionCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  // A touch smaller than the Feather glyph beside them: these PNGs are drawn
  // edge to edge, where a font icon carries its own padding, so matching the
  // numbers would make them read larger.
  actionImage: { width: 18, height: 18, resizeMode: "contain" },
  actionLabel: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_500Medium" },

  // The rule between the balance and the lists. Thicker than a hairline
  // because it separates two halves of the screen, not two rows. No radius:
  // rounded ends only make sense on a bar that stops short of the edge.
  sectionSplit: { height: 4, opacity: 0.7 },

  sectionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  /**
   * The label is the button, so the button has to be bigger than the label.
   *
   * An 11pt caption is 14 points tall, and wrapping the Text alone made that
   * the whole target - you had to land on the letters themselves to switch
   * lists. The padding is taken back out with a negative margin, so the tap
   * area grows to 50 points while the bar keeps the height it had.
   *
   * The gap shrinks by what the padding adds, which leaves the two captions
   * the same 18 points apart they were drawn at.
   */
  sectionTabs: { flexDirection: "row", gap: 2, marginVertical: -12, marginLeft: -8 },
  sectionTab: { paddingHorizontal: 8, paddingVertical: 12 },
  sectionCaption: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.1,
  },
  viewMoreRow: { alignItems: "center", paddingTop: 18, paddingBottom: 4 },
  viewMoreRowText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium" },
  viewMoreBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewMoreText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  balanceCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    backgroundColor: "#1a1a1a",
    padding: 20,
    paddingBottom: 24,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  headerDivider: { width: 1, height: 20, backgroundColor: "#444" },
  idBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#333",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  idText: { color: "#ccc", fontSize: 12, fontFamily: "Inter_500Medium" },
  balanceSection: { marginBottom: 20 },
  balanceTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  balanceLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#999" },
  balanceAmount: { fontSize: 42, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -1 },
  balanceDecimal: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#888" },
  balanceUsd: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#999", marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: "#333", marginBottom: 20 },
  actionRow: { flexDirection: "row", gap: 12 },
  depositBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#444",
  },
  depositBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  transferBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#555",
  },
  transferBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Quick Actions */
  quickRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 12,
  },
  quickItem: { flex: 1, alignItems: "center", gap: 8 },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },

  /* Trading Competition Card */
  compCardWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    overflow: "hidden",
  },
  compCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(200,245,60,0.25)",
    borderRadius: 16,
    overflow: "hidden",
  },
  compCardGlow: {
    position: "absolute",
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(200,245,60,0.18)",
    top: -60, right: -40,
  },
  compCloseBtn: {
    position: "absolute",
    top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center", justifyContent: "center",
    zIndex: 2,
  },
  compStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(200,245,60,0.15)",
    borderWidth: 1,
    borderColor: "rgba(200,245,60,0.4)",
    marginBottom: 8,
  },
  compStatusPillLive: {
    backgroundColor: "rgba(239,68,68,0.18)",
    borderColor: "rgba(239,68,68,0.5)",
  },
  compLiveDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444",
  },
  compStatusText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
  },
  compCardTitle: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  compCardPrize: {
    color: "#81FB02",
    fontFamily: "Inter_700Bold",
  },
  compCardSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  compCardCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
  },
  compCardCtaText: {
    color: "#81FB02",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },

  sectionDivider: { height: 1, marginHorizontal: 20, marginBottom: 16 },

  /* Tab Toggle */
  tabToggleRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  tabToggleItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  tabToggleActive: {
    borderBottomColor: "#81FB02",
  },
  tabToggleText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Wallet */
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  walletInfo: { flex: 1, gap: 4 },
  walletAsset: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  chainRow: { flexDirection: "row", alignItems: "center" },
  chainLogo: { width: 18, height: 18, borderRadius: 9, marginLeft: -6, borderWidth: 1.5, overflow: "hidden" as const },
  chainCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 4 },
  walletBal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  walletUsd: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Expanded wallet */
  expandedWrap: {
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  chainBalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chainBalLogo: { width: 20, height: 20, borderRadius: 10, overflow: "hidden" as const },
  chainBalName: { flex: 1, fontSize: 13, lineHeight: 17, fontFamily: "Inter_400Regular" },
  chainBalAmount: { fontSize: 13, lineHeight: 17, fontFamily: ASSET_MONO },

  /* Transactions */
  section: { paddingHorizontal: 20 },
  /**
   * No horizontal padding, unlike `section`.
   *
   * TransactionItem pads itself by 20, so wrapping it in a padded section put
   * the rows at 40 while the section bar above them sat at 20 - the icons
   * started well right of the TRANSACTIONS label and the amounts stopped short
   * of View more. The asset rows do need `section`, since walletRow has no
   * padding of its own.
   */
  txSection: {},

  // ── Deposit ──────────────────────────────────
  sheetOverlay: { ...StyleSheet.absoluteFillObject },
  // Dock, not overlay: the card is positioned by this and the backdrop sits
  // behind it, so tapping outside the card still closes.
  sheetDock: { flex: 1, justifyContent: "flex-end" },
  /**
   * Rounded on all four corners and held off every edge.
   *
   * A sheet flush with the bottom is part of the screen; one inset from it is
   * an object resting on top - which is what a blurred backdrop is already
   * saying. The two have to agree or the effect reads as a mistake.
   */
  sheet: {
    marginHorizontal: 12,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 14,
    // Lifts the card off the blur so the two do not merge into one surface.
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 4, marginBottom: 16 },
  sheetTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sheetSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },
  sheetClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  // Rows sit a step lighter than the card, so they read as objects on it rather
  // than panels cut out of it.
  method: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 18,
    marginBottom: 10,
  },
  methodIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  methodImg: { width: 20, height: 20, resizeMode: "contain" },
  methodTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.25 },
  methodSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Add money. Two tiles rather than rows: the send sheet has three options and
  // reads as a list, this one is a fork.
  depoGrid: { flexDirection: "row", gap: 10 },
  depoTile: { flex: 1, borderRadius: 20, padding: 15 },
  depoTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginTop: 14 },
  depoSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },

  // ── Send ─────────────────────────────────────────────────
  sendGrip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 2, marginBottom: 20 },
  sendHead: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 4, marginBottom: 10 },
  // A long step above the row titles. Without that gap the heading reads as
  // the first item in the list rather than the name of it.
  sendHeading: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.8 },
  sendRow: { flexDirection: "row", alignItems: "center", gap: 15, paddingHorizontal: 4, paddingVertical: 17 },
  sendMark: { width: 21, height: 21, resizeMode: "contain" },
  sendTitle: { fontSize: 16.5, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sendSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  sendHeadSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 3 },
  // A soft target on the right of each row, rather than a bare chevron: it
  // gives the eye somewhere to land at the end of the line.
  sendGo: { width: 30, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },

  // ── Assets ───────────────────────────────────────
  portfolioHead: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  portfolioRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tagBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 13, borderRadius: 10 },
  tagText: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: -0.1 },
  // Called swap in the app and sweep everywhere underneath it: the route, the
  // API and the transaction type were named before the feature was, and
  // renaming a stored enum to match a label is not worth a migration.
  swapTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  swapIcon: { width: 14, height: 14, resizeMode: "contain" },
  swapTagText: { fontSize: 12.5, fontFamily: "Inter_700Bold", letterSpacing: -0.1 },
  chainBalEmpty: { fontSize: 12.5, fontFamily: "Inter_400Regular", paddingVertical: 8 },
  // Large enough to be the thing you see first. This screen has one headline
  // and it is this number.
  portfolioValue: {
    fontSize: 38,
    lineHeight: 44,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.2,
    marginTop: 4,
  },
  // Segment gaps come from the row's own gap, so no segment needs a border.
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 20,
    gap: 13,
  },
  ledgerHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 6 },
  ledgerCap: { fontSize: 9.5, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 1.4 },
  assetInfo: { flex: 1, gap: 3 },
  assetSymbol: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  assetChainNames: { fontSize: 11.5, lineHeight: 16, fontFamily: ASSET_MONO, marginTop: 1 },
  assetAmounts: { alignItems: "flex-end", gap: 2 },
  assetBal: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  assetShare: { fontSize: 11.5, lineHeight: 16, fontFamily: ASSET_MONO },
  assetChevron: { width: 15, alignItems: "center" },
  // Indented to the token name above, not past it, so the chains read as
  // that holding broken open rather than as a nested list.
  // Indented to the token name above, so the chains read as that holding
  // broken open rather than as a list starting somewhere new.
  chainBreakdown: { gap: 13, paddingLeft: 73, paddingRight: 20, paddingBottom: 15, paddingTop: 6 },
  chainBalRowNew: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  viewAll: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 32 },

  /* KYC Sheet */
  // KYC prompt — bold centred dialog rather than a bottom sheet, so it reads as
  // a deliberate ask. Dismissible via the X or "Not now".
  dialogOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },
  dialogCard: {
    width: "100%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: "center",
  },
  dialogHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(150,150,150,0.4)",
    marginBottom: 22,
  },
  dialogClose: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  kycBadgeImg: { width: 72, height: 72, marginBottom: 18 },
  dialogTitle: {
    fontSize: 23,
    lineHeight: 30,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  dialogSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 6,
  },
  dialogBtn: {
    width: "100%",
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  dialogBtnText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  errBox: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 14,
  },
  errBoxText: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  dialogSkip: { alignItems: "center", paddingVertical: 16, marginTop: 2 },
  dialogSkipText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
});
