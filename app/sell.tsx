import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  Switch,
  BackHandler,
  Animated,
  Easing,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBeneficiaries, deleteBeneficiary, resolveAccount as resolveAccountApi, type Beneficiary } from "@/services/beneficiaries";

/** Recents taken off the list. Keyed by bank and number, as the list is. */
const HIDDEN_RECENTS_KEY = "mm_hidden_recents";
import { TOKEN_NETWORKS, NIGERIAN_BANKS, bankLogoSource, assetLabel, onChainAsset, fmtNaira, spendableBalance, type TokenSymbol, type NetworkInfo } from "@/constants/transfer";
import { getSellLimits } from "@/services/transactions";
import { Keypad } from "@/components/Keypad";
import { AccountScanner } from "@/components/AccountScanner";
import { AmountCurrency } from "@/components/CurrencyToggle";

type SellToken = "USDC" | "USDT" | "USDCx" | "MOVE" | "SOL" | "cNGN";
const FEE_RATE = 0.005;
const PROCESSING_FEE = 50;

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
};

/**
 * Tokens that may be sold to a bank account.
 *
 * SOL is deliberately absent.
 */
const SELLABLE: { symbol: SellToken; name: string }[] = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "USDT", name: "USDT" },
  { symbol: "MOVE", name: "Movement" },
  // A naira stablecoin. It sells like any other token - priced in dollars off
  // its own feed and converted back at the posted rate - so it needs no special
  // case here, only a row.
  { symbol: "cNGN", name: "cNGN" },
];

/**
 * The floor a sell has to clear.
 *
 * Holdings under it are left out of the picker entirely rather than offered
 * and then refused at the amount step - the same 500 the amount field
 * enforces.
 */
const MIN_SELL_NGN = 500;

export default function SellScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { usdcBalance, usdtBalance, usdcxBalance, moveBalance, solBalance, walletReady, walletBalances, rates, user, refreshRates, transactions } = useApp();

  useEffect(() => { if (!rates) refreshRates(); }, [rates, refreshRates]);

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to sell crypto.", [{ text: "OK", onPress: () => router.back() }]);
    }
  }, [walletReady]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const kbHeight = useKeyboardHeight();
  const verified = !!user?.verified;

  // ─── Bank account tabs ───
  // Recent first: the last person you paid is far more often the next one
  // than anyone in a saved list.
  const [acctTab, setAcctTab] = useState<"beneficiary" | "recent">("recent");
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loadingBen, setLoadingBen] = useState(true);

  const fetchBeneficiaries = useCallback(async () => {
    try {
      setLoadingBen(true);
      const { beneficiaries: bens } = await getBeneficiaries({ limit: 20 });
      setBeneficiaries(bens);
    } catch {}
    setLoadingBen(false);
  }, []);

  useEffect(() => { fetchBeneficiaries(); }, [fetchBeneficiaries]);

  /**
   * Recent accounts somebody has taken off the list.
   *
   * Recent is not a table. It is read back out of past SELL transactions, so
   * there is no row to delete - taking one off the list means remembering not
   * to show it, and the receipts it was derived from stay exactly as they are.
   *
   * On the device rather than the server, because that is where the decision
   * belongs: it is about what this list looks like, not about the money. The
   * cost is that it does not follow somebody to a new phone, where the list
   * simply rebuilds itself from their history.
   */
  const [hiddenRecents, setHiddenRecents] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_RECENTS_KEY)
      .then((raw) => {
        if (!raw) return;
        const list = JSON.parse(raw);
        if (Array.isArray(list)) setHiddenRecents(new Set(list.map(String)));
      })
      .catch(() => {});
  }, []);

  const hideRecent = useCallback((key: string) => {
    setHiddenRecents((cur) => {
      const next = new Set(cur);
      next.add(key);
      AsyncStorage.setItem(HIDDEN_RECENTS_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  /** Editing is per-visit: it never opens in a state where a tap deletes. */
  const [editingPeople, setEditingPeople] = useState(false);

  /**
   * Take one off the list, by whichever route that list allows.
   *
   * The two tabs are not the same kind of thing. A beneficiary is a row
   * somebody saved on purpose, so removing it is a delete on the server. A
   * recent is read back out of old receipts, so it can only be hidden - and
   * deleting the receipt to tidy a shortcut list would be an appalling trade.
   */
  const removePerson = useCallback(
    async (id: string) => {
      if (acctTab === "recent") {
        hideRecent(id);
        return;
      }
      // Gone from the list first, so the row does not sit there looking
      // unresponsive while the request is in flight.
      setBeneficiaries((cur) => cur.filter((b) => b.id !== id));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      try {
        await deleteBeneficiary(id);
      } catch {
        // It is still there. Put it back rather than leave the list lying.
        fetchBeneficiaries();
      }
    },
    [acctTab, hideRecent, fetchBeneficiaries],
  );

  // Extract unique recent bank accounts from sell transactions
  const recentAccounts = useMemo(() => {
    const seen = new Set<string>();
    const accounts: { accountName: string; accountNumber: string; bankName: string; bankCode: string }[] = [];
    for (const tx of transactions) {
      if (tx.type !== "SELL" || !tx.metadata) continue;
      const m = tx.metadata as any;
      const key = `${m.bankName}-${m.accountNumber}`;
      if (seen.has(key) || !m.accountNumber || !m.bankName || !m.accountName) continue;
      seen.add(key);
      accounts.push({ accountName: m.accountName, accountNumber: m.accountNumber, bankName: m.bankName, bankCode: m.bankCode || "" });
      if (accounts.length >= 10) break;
    }
    return accounts;
  }, [transactions]);

  const [selectedAsset, setSelectedAsset] = useState<SellToken>("USDC");
  const [assetAutoSelected, setAssetAutoSelected] = useState(false);

  const [selectedChain, setSelectedChain] = useState<NetworkInfo | null>(null);
  const [amount, setAmount] = useState("");   // canonical NET NGN string (what the user receives)
  const [display, setDisplay] = useState(""); // text shown in the input (NGN or USD)
  const [currency, setCurrency] = useState<AmountCurrency>("NGN");
  const [amountError, setAmountError] = useState("");
  const [converting, setConverting] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");

  // ─── Account-first bank lookup ───
  const [acctNum, setAcctNum] = useState("");
  const [pickedBank, setPickedBank] = useState("");
  const [pickedBankCode, setPickedBankCode] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [bankSearch, setBankSearch] = useState("");

  /**
   * Recipient first, amount second.
   *
   * Who is being paid decides what the screen can even offer - the available
   * balance, the limit, the fee - so asking for it first means the amount step
   * never has to be corrected after the fact.
   */
  const [step, setStep] = useState<"recipient" | "amount">("recipient");
  /** Free text the sender attaches. Not yet carried to the payout itself. */
  const [narration, setNarration] = useState("");
  const [saveBeneficiary, setSaveBeneficiary] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  /**
   * Whether the Bank row is being typed into.
   *
   * The list appears under the field rather than in a sheet: a sheet covers
   * the account number you just entered, and picking a bank is a step in the
   * same form rather than a detour out of it.
   */
  const [bankTyping, setBankTyping] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  /**
   * On the amount step, back means the recipient step.
   *
   * Done by switching the swipe off rather than by cancelling the removal.
   * A `beforeRemove` listener cannot veto a native-stack pop: the screen goes
   * away natively regardless and only the JS side is held back, which leaves a
   * detached tree still rendering - React Navigation warns about exactly this.
   * With the gesture disabled there is nothing to veto, and the header button
   * is ours to point wherever we like.
   */
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: step !== "amount" });
  }, [navigation, step]);

  // Android's hardware back is not a gesture and ignores that option.
  useEffect(() => {
    if (step !== "amount") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setStep("recipient");
      return true;
    });
    return () => sub.remove();
  }, [step]);

  /**
   * Fill the recipient rather than jump to the summary.
   *
   * Picking someone you have paid before is a shortcut through the typing, not
   * a decision to send - the amount still has to be entered, and the fields
   * stay editable in case the account was right but the bank has changed.
   */
  const fillRecipient = (acct: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    bankCode: string | null;
  }) => {
    Haptics.selectionAsync();
    setAcctNum(acct.accountNumber);
    setPickedBank(acct.bankName);
    setPickedBankCode(acct.bankCode || "");
    setResolvedName(acct.accountName);
    setResolveFailed(false);
    setShowPeople(false);
  };

  const savedPeople = beneficiaries.map((b) => ({
    id: b.id,
    accountName: b.accountName,
    accountNumber: b.accountNumber,
    bankName: b.bankName,
    bankCode: b.bankCode,
  }));
  const recentPeople = recentAccounts
    .filter((r) => !hiddenRecents.has(`${r.bankName}-${r.accountNumber}`))
    .map((r) => ({
      id: `${r.bankName}-${r.accountNumber}`,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      bankName: r.bankName,
      bankCode: r.bankCode,
    }));
  const people = acctTab === "beneficiary" ? savedPeople : recentPeople;
  const hasPeople = savedPeople.length > 0 || recentPeople.length > 0;

  const POPULAR_BANKS = ["Opay", "Palmpay", "Kuda Bank", "Moniepoint", "United Bank for Africa", "Sterling Bank"];

  const filteredBanks = bankSearch
    ? NIGERIAN_BANKS.filter((b) => b.toLowerCase().includes(bankSearch.toLowerCase()))
    : NIGERIAN_BANKS;

  /** The handful most people are sending to, above the full list. */
  const suggestedBanks = bankSearch
    ? []
    : POPULAR_BANKS.filter((b) => NIGERIAN_BANKS.includes(b));

  const chooseBank = (bank: string) => {
    Haptics.selectionAsync();
    handlePickBank(bank);
    setBankSearch("");
    setBankTyping(false);
    Keyboard.dismiss();
  };

  // A full account number with no bank yet is the moment to show the list.
  useEffect(() => {
    if (acctNum.length === 10 && !pickedBank) {
      Keyboard.dismiss();
      setBankSearch("");
      setBankTyping(true);
    } else if (acctNum.length < 10) {
      setPickedBank("");
      setPickedBankCode("");
      setResolvedName("");
    }
  }, [acctNum]);

  // Auto-resolve when bank picked + 10 digits
  const resolveNewAccount = useCallback(async (bankName: string, accountNumber: string) => {
    if (accountNumber.length < 10 || !bankName) return;
    setResolving(true);
    setResolveFailed(false);
    try {
      const result = await resolveAccountApi({ accountNumber, bankName });
      if (result.resolved && result.accountName) {
        setResolvedName(result.accountName);
        setResolveFailed(false);
        if (result.bankCode) setPickedBankCode(result.bankCode);
      } else {
        setResolvedName("");
        setResolveFailed(true);
      }
    } catch {
      setResolvedName("");
      setResolveFailed(true);
    }
    setResolving(false);
  }, []);

  const handlePickBank = (bank: string) => {
    setPickedBank(bank);
    setResolvedName("");
    setResolveFailed(false);
    resolveNewAccount(bank, acctNum);
  };

  const clearRecipient = () => {
    setPickedBank("");
    setPickedBankCode("");
    setResolvedName("");
    setResolveFailed(false);
    setAcctNum("");
  };

  // ─── Scan account from image (camera or library) ───
  /**
   * An account handed over by the standalone scanner.
   *
   * Applied once, on arrival: the scan happened on another screen, so this one
   * opens already filled in rather than making the user scan again.
   */
  const scanned = useLocalSearchParams<{ scanAccount?: string; scanBank?: string }>();
  const scanApplied = useRef(false);

  useEffect(() => {
    if (scanApplied.current || !scanned.scanAccount) return;
    scanApplied.current = true;
    applyScanResult({
      accountNumber: String(scanned.scanAccount),
      bankName: scanned.scanBank ? String(scanned.scanBank) : null,
    });
  }, [scanned.scanAccount, scanned.scanBank]);

  const applyScanResult = (result: { accountNumber: string | null; bankName: string | null }) => {
    if (!result.accountNumber && !result.bankName) {
      Alert.alert("Nothing found", "Couldn't read an account number from that image. Try a clearer photo.");
      return;
    }
    if (!result.accountNumber) {
      Alert.alert(
        "No account number found",
        `We spotted ${result.bankName ? `"${result.bankName}"` : "a bank"}, but not a 10-digit account number. Try again with a clearer photo.`,
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (result.bankName) {
      // Set bank first so the 10-digit useEffect skips opening the bank picker.
      setPickedBank(result.bankName);
      setPickedBankCode("");
      setResolvedName("");
      setResolveFailed(false);
      setAcctNum(result.accountNumber);
      resolveNewAccount(result.bankName, result.accountNumber);
    } else {
      // Only account number — let the existing useEffect open the bank sheet.
      setAcctNum(result.accountNumber);
    }
  };

  const handleScanAccount = () => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setScannerOpen(true);
  };



  /**
   * Every sellable holding, flattened to one row each.
   *
   * The sheet used to list tokens and then ask for the network in a second
   * sheet - two taps and two decisions for what is really one choice: which
   * pile of money to sell. Flattening also lets each row carry its own
   * balance, so a network you hold nothing on is simply not there instead of
   * being offered and then rejected.
   */
  const sellOptions = useMemo(() => {
    const out: {
      key: string;
      token: SellToken;
      name: string;
      chain: NetworkInfo;
      balance: number;
      ngn: number;
      /** False below the minimum: listed, but not a choice. */
      sellable: boolean;
    }[] = [];

    for (const { symbol, name } of SELLABLE) {
      for (const net of TOKEN_NETWORKS[symbol] || []) {
        const held = walletBalances.find(
          (b) => b.asset === onChainAsset(symbol, net.tag) && b.chain === net.tag,
        );
        const balance = held?.balance ?? 0;
        const ngn = balance * ((rates as any)?.[symbol]?.ngn || 0);
        // Nothing at all is still nothing to show.
        if (ngn <= 0) continue;
        // Under the floor it stays in the list, dimmed and unselectable. It
        // used to be dropped, which meant a holding you could see on the home
        // screen was simply absent here with nothing saying why - and cNGN
        // makes that likely, since a round 500 of it is worth under 500 naira.
        out.push({
          key: `${symbol}-${net.tag}`,
          token: symbol,
          name,
          chain: net,
          balance,
          ngn,
          sellable: ngn >= MIN_SELL_NGN,
        });
      }
    }
    // Biggest first: the one most likely to be picked needs no scrolling.
    return out.sort((a, b) => b.ngn - a.ngn);
  }, [walletBalances, rates]);

  /**
   * Open on the biggest holding that can actually be sold.
   *
   * This was two guesses that could disagree. One effect chose the token with
   * the most USD across every chain; a second chose the chain holding the most
   * of that token. USDC and USDT run on the same four networks, so a chain
   * settled while the token was still USDC stayed put when the token changed
   * to USDT - and the screen opened on "USDT on Movement" reading ₦0 while the
   * money sat on another chain entirely.
   *
   * One guess now, off the top of `sellOptions`: the same list the picker
   * shows, already sorted biggest first and already missing anything under the
   * ₦500 floor. The token and the network come from one row, so they cannot
   * contradict each other, and the screen can no longer open on a holding that
   * is not even offered in the list.
   *
   * Still only an opening guess - it fires once, so a balance refresh never
   * overwrites a choice the person has made.
   */
  useEffect(() => {
    const top = sellOptions.find((o) => o.sellable);
    if (assetAutoSelected || !top) return;
    setSelectedAsset(top.token);
    setSelectedChain(top.chain);
    setAssetAutoSelected(true);
  }, [sellOptions, assetAutoSelected]);

  /**
   * Open on the network holding the most of this token.
   *
   * It is only an opening guess. It used to re-run on every balance refresh
   * and overwrite whatever the person had picked, so choosing the smaller of
   * two chains silently bounced back to the larger one a few seconds later -
   * which looked like the picker not working at all.
   */
  useEffect(() => {
    const nets = TOKEN_NETWORKS[selectedAsset] || [];
    if (nets.length === 0) { setSelectedChain(null); return; }
    if (nets.length === 1) { setSelectedChain(nets[0]); return; }

    const balanceOn = (net: NetworkInfo) =>
      walletBalances.find(
        (b) => b.asset === onChainAsset(selectedAsset, net.tag) && b.chain === net.tag,
      )?.balance ?? 0;

    setSelectedChain((current) => {
      // A network already valid for this token is the user's, not ours - but
      // only while it holds some of it. Every dollar token runs on the same
      // four chains, so without that second test a network settled for one
      // token rides along to the next and leaves the screen sitting on an
      // empty pile.
      if (current && nets.some((net) => net.tag === current.tag) && balanceOn(current) > 0) {
        return current;
      }

      let best = nets[0];
      let bestBal = 0;
      for (const net of nets) {
        const bal = balanceOn(net);
        if (bal > bestBal) { bestBal = bal; best = net; }
      }
      return bestBal > 0 ? best : null;
    });
  }, [selectedAsset, walletBalances]);

  // Chain balance
  const chainBalance = useMemo(() => {
    if (!selectedChain) return 0;
    const entry = walletBalances.find(b => b.asset === onChainAsset(selectedAsset, selectedChain.tag) && b.chain === selectedChain.tag);
    return entry?.balance ?? 0;
  }, [walletBalances, selectedAsset, selectedChain]);

  // NGN rate
  const ngnRate = useMemo(() => {
    if (!rates) return 0;
    return rates[selectedAsset]?.ngn || 0;
  }, [rates, selectedAsset]);

  const usdRate = useMemo(() => {
    if (!rates) return 0;
    return rates[selectedAsset]?.usd || 0;
  }, [rates, selectedAsset]);

  // NGN per 1 USD (USDC ≈ $1). Used to let the user type the payout in USD. 0 until rates load.
  const usdNgn = useMemo(() => rates?.USDC?.ngn || 0, [rates]);

  const maxNgn = ngnRate > 0 ? Math.floor(spendableBalance(selectedChain?.tag ?? "", chainBalance) * ngnRate) : 0;
  // Compute maxNet: the largest net (receive) amount such that gross (net + fees on net) <= maxNgn.
  const maxNet = (() => {
    if (maxNgn <= 0) return 0;
    let net = Math.floor((maxNgn - PROCESSING_FEE) / (1 + FEE_RATE));
    while (net > 0) {
      const pct = Math.round(net * FEE_RATE);
      if (net + pct + PROCESSING_FEE <= maxNgn) break;
      net--;
    }
    return Math.max(0, net);
  })();
  /**
   * The limits the server will actually apply, including what today has spent.
   *
   * These were a constant and a guess - 200,000 gated on having made five
   * transactions - which knew nothing about whether the account was verified
   * or how much of the day was already gone. So an unverified account could
   * type 50,000, reach the summary, confirm, and be refused there.
   */
  const [limits, setLimits] = useState<{ perTx: number; dailyLimit: number; remaining: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getSellLimits()
      .then((l) => alive && setLimits({ perTx: l.perTx, dailyLimit: l.dailyLimit, remaining: l.remaining }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const perTx = limits?.perTx ?? 500000;
  const dailyCap = limits?.dailyLimit ?? 2000000;
  const leftToday = limits?.remaining ?? dailyCap;
  // What the balance allows, what one transfer allows, what the day has left.
  const effectiveMax = Math.min(maxNet, perTx, Math.max(leftToday, 0));

  const numAmount = Number(amount) || 0;
  // User types NET (what they receive). Backend computes fee on GROSS:
  //   net = gross - round(gross * FEE_RATE) - PROCESSING_FEE
  // Solve for the smallest gross whose post-fee net is >= numAmount, so the
  // user always receives at least what they typed.
  const { grossNgn, feeNgn } = (() => {
    if (numAmount <= 0) return { grossNgn: 0, feeNgn: 0 };
    const netAt = (g: number) => {
      const pct = Math.round(g * FEE_RATE);
      return Math.round(g - pct - PROCESSING_FEE);
    };
    let g = Math.ceil((numAmount + PROCESSING_FEE) / (1 - FEE_RATE));
    // Step up until net >= target (handles rounding when estimate is short).
    let safety = 100;
    while (safety-- > 0 && netAt(g) < numAmount) g++;
    // Step down while net still >= target, to find the minimum gross.
    safety = 100;
    while (safety-- > 0 && g > 1 && netAt(g - 1) >= numAmount) g--;
    const pct = Math.round(g * FEE_RATE);
    return { grossNgn: g, feeNgn: pct + PROCESSING_FEE };
  })();
  const tokenAmount = ngnRate > 0 ? grossNgn / ngnRate : 0;

  const dec = selectedAsset === "MOVE" ? 2 : 4;

  // Converting spinner when amount changes
  useEffect(() => {
    if (numAmount > 0) {
      setConverting(true);
      const t = setTimeout(() => setConverting(false), 400);
      return () => clearTimeout(t);
    } else {
      setConverting(false);
    }
  }, [amount]);

  // Set the canonical NET NGN amount and keep the input text in sync with the
  // selected currency (used by MAX).
  const setNgn = (ngn: string) => {
    setAmount(ngn);
    setDisplay(currency === "USD" && usdNgn > 0 && ngn ? (Number(ngn) / usdNgn).toFixed(2) : ngn);
  };

  /**
   * The caret blinks even though nothing is focused.
   *
   * The keypad is the app's own, so there is no system cursor and the figure
   * was indistinguishable from a heading - people looked for a field to tap.
   * A caret is the cheapest way to say "this is where your typing lands".
   */
  const caret = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(caret, { toValue: 0, duration: 420, delay: 460, useNativeDriver: true }),
        Animated.timing(caret, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [caret]);

  /**
   * How much of what you can actually send this is.
   *
   * The screen used to leave a third of itself empty between the figure and
   * the asset card, and answered "how much is left?" only by printing a
   * balance further down - so the one thing a person wants while typing, the
   * proportion, had to be worked out from two numbers at opposite ends.
   *
   * Measured against `effectiveMax` rather than the raw balance, because the
   * real ceiling is whichever of the balance, the per-transfer cap and what
   * remains of today is lowest. Filling a bar to the balance and then refusing
   * the transfer would be a lie told in a nicer way.
   */
  const ceiling = effectiveMax > 0 ? effectiveMax : 0;
  const over = numAmount > 0 && ceiling > 0 && numAmount > ceiling;

  const figText = display ? Number(display.replace(/,/g, "")).toLocaleString("en-NG") : "0";
  // Shrinks as it lengthens, so a large figure never runs into the edge.
  const figSize = figText.length > 9 ? 30 : figText.length > 7 ? 36 : figText.length > 5 ? 40 : 46;
  // Box, not glyph: `contain` scales the mark's transparent margin too, so it
  // fills about two thirds of whatever is set here. 1.075x the point size
  // lands it on the cap height of the digits beside it.
  const markBox = Math.round(figSize * 1.075);

  const figScale = useRef(new Animated.Value(1)).current;
  const figShake = useRef(new Animated.Value(0)).current;
  const lastDisplay = useRef(display);

  useEffect(() => {
    const changed = display !== lastDisplay.current;
    const grew = display.length > lastDisplay.current.length;
    lastDisplay.current = display;

    if (changed && over) {
      // Refusing a keystroke silently is how a person ends up typing the same
      // wrong number twice. The figure moves instead.
      figShake.setValue(0);
      Animated.sequence([
        Animated.timing(figShake, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(figShake, { toValue: -1, duration: 65, useNativeDriver: true }),
        Animated.timing(figShake, { toValue: 0.45, duration: 55, useNativeDriver: true }),
        Animated.timing(figShake, { toValue: 0, duration: 55, useNativeDriver: true }),
      ]).start();
    } else if (changed && grew) {
      Animated.sequence([
        Animated.timing(figScale, {
          toValue: 1.05,
          duration: 80,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(figScale, {
          toValue: 1,
          damping: 12,
          stiffness: 320,
          mass: 0.6,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [display, over, figScale, figShake]);

  const handleCurrencyChange = (next: AmountCurrency) => {
    if (next === currency || usdNgn <= 0) return;
    setCurrency(next);
    if (!amount) { setDisplay(""); return; }
    setDisplay(next === "USD" ? (Number(amount) / usdNgn).toFixed(2) : amount);
  };

  const handleMax = () => {
    if (effectiveMax > 0) {
      setNgn(effectiveMax.toString());
      if (amountError) setAmountError("");
    }
  };

  const handleAmountChange = (v: string) => {
    if (!selectedChain) return;
    if (amountError) setAmountError("");
    if (currency === "NGN") {
      // Naira has kobo, so the point is allowed - but only one, and only two
      // places after it. A third decimal is not a smaller amount, just a
      // longer string.
      const clean = v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      const capped = clean.includes(".") ? clean.slice(0, clean.indexOf(".") + 3) : clean;
      // Left as typed. Snapping the figure back to the maximum hides why it
      // moved; the message under the field says what the ceiling is.
      setAmount(capped);
      setDisplay(capped);
    } else {
      const clean = v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      const ngnNum = usdNgn > 0 && clean ? Math.round(Number(clean) * usdNgn) : 0;
      setAmount(ngnNum ? ngnNum.toString() : "");
      setDisplay(clean);
    }
  };

  const filteredOptions = assetSearch.trim()
    ? sellOptions.filter((o) =>
        `${o.name} ${o.chain.name} ${o.token}`
          .toLowerCase()
          .includes(assetSearch.trim().toLowerCase()),
      )
    : sellOptions;

  const validateAmount = () => {
    if (!numAmount || numAmount <= 0) {
      setAmountError("Enter a valid amount");
      return false;
    }
    if (!selectedChain) {
      setAmountError("Select a network first");
      return false;
    }
    if (ngnRate <= 0) {
      setAmountError("Rates not available yet");
      return false;
    }
    if (tokenAmount > chainBalance) {
      setAmountError(`Insufficient. You can sell up to ₦${effectiveMax.toLocaleString()} on ${selectedChain.name}`);
      return false;
    }
    if (numAmount < 500) {
      setAmountError("Minimum sell is ₦500");
      return false;
    }
    if (amountError) return false;
    return true;
  };

  const goToSummary = (bankDetails: { bankName: string; accountNumber: string; accountName: string; bankCode: string }, isBeneficiary = false) => {
    if (!validateAmount()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/sell-summary",
      params: {
        sellToken: onChainAsset(selectedAsset, selectedChain!.tag),
        sellChain: selectedChain!.tag,
        sellAmount: tokenAmount.toString(),
        targetNetNgn: numAmount.toString(),
        bank: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        accountName: bankDetails.accountName,
        bankCode: bankDetails.bankCode,
        isBeneficiary: isBeneficiary ? "1" : "0",
        narration: narration.trim(),
        saveBeneficiary: saveBeneficiary ? "1" : "0",
      },
    } as any);
  };

  const handleSelectAccount = (acct: { bankName: string; accountNumber: string; accountName: string; bankCode: string }) => {
    goToSummary(acct);
  };

  const recipientReady = !!resolvedName && !!pickedBank && acctNum.length >= 10;
  /**
   * Checked on every keystroke, in this order: the day first, because when
   * nothing is left the per-transfer ceiling is beside the point, then the
   * ceiling, then the balance.
   */
  const limitError = (() => {
    if (numAmount <= 0 || !selectedChain) return "";
    if (limits && leftToday <= 0) {
      return `You have used your ${fmtNaira(dailyCap)} for today. Try again tomorrow.`;
    }
    if (limits && numAmount > leftToday && leftToday < dailyCap) {
      return `${fmtNaira(leftToday)} left of today's ${fmtNaira(dailyCap)}.`;
    }
    if (numAmount > perTx) {
      return limits && perTx < 500000
        ? `Most you can send at once is ${fmtNaira(perTx)}. Verify your ID to raise it.`
        : `Most you can send at once is ${fmtNaira(perTx)}.`;
    }
    if (limits && numAmount > leftToday) {
      return `${fmtNaira(leftToday)} left of today's ${fmtNaira(dailyCap)}.`;
    }
    if (maxNet > 0 && numAmount > maxNet) {
      return `Your ${selectedChain.name} balance covers ${fmtNaira(maxNet)}.`;
    }
    return "";
  })();

  const amountReady = numAmount > 0 && !amountError && !limitError && !!selectedChain;

  const balanceLabel = selectedChain
    ? `${assetLabel(selectedAsset)} on ${selectedChain.name}`
    : "Choose what to sell";

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {step === "recipient" ? (
        <>
          <View style={ns.head}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[ns.headBtn, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              {/* Back, not close: this screen is a step in the send flow, and
                  an X reads as abandoning it rather than returning. */}
              <Feather name="arrow-left" size={20} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[ns.headTitle, { color: colors.foreground }]}>Send money</Text>
            <TouchableOpacity
              onPress={handleScanAccount}
              style={[ns.headBtn, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              <Image
                source={require("@/assets/images/qr-code.png")}
                style={[ns.scanMark, { tintColor: colors.foreground }]}
              />
            </TouchableOpacity>
          </View>
          <View style={[ns.rule, { backgroundColor: colors.border }]} />
          {/*
            No keyboard-avoiding wrapper here. With behavior="padding" it
            shrinks this ScrollView by the keyboard's height, and with a tall
            keyboard plus the autocomplete bar the box collapses to almost
            nothing - the form vanishes and only the footer is left, which is
            what the note in this file has always warned about.

            automaticallyAdjustKeyboardInsets insets the *content* instead and
            leaves the box alone; the footer below positions itself.
          */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[ns.body, { paddingBottom: 150 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            {/* Label on the left, value on the right - a form laid out as a
                list rather than a stack of boxed inputs. */}
            <View style={ns.field}>
              <Text style={[ns.fieldLabel, { color: colors.foreground }]}>To</Text>
              <TextInput
                style={[ns.fieldInput, { color: colors.foreground }]}
                value={acctNum}
                onChangeText={setAcctNum}
                placeholder="Account number"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={10}
              />
              {/* People, not a chevron. A caret on a text field reads as "this
                  field has options"; this says the options are accounts you
                  have already paid. */}
              {resolving ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : hasPeople ? (
                <TouchableOpacity
                  onPress={() => { Keyboard.dismiss(); setShowPeople(true); }}
                  hitSlop={14}
                >
                  <Feather name="users" size={15} color={colors.foreground} />
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={[ns.rule, { backgroundColor: colors.border }]} />

            <View style={ns.field}>
              <Text style={[ns.fieldLabel, { color: colors.foreground }]}>Bank</Text>
              <TextInput
                style={[ns.fieldInput, { color: colors.foreground }]}
                value={bankTyping ? bankSearch : pickedBank}
                /**
                 * Typing over a chosen bank un-chooses it.
                 *
                 * The field showed what was being typed while the choice
                 * behind it stayed put, so picking Opay, letting the name
                 * resolve, then typing "Okash" left a screen that said Okash
                 * and a transfer that went to Opay - with Continue still lit,
                 * because a resolved name and a picked bank were both still
                 * there. Nothing warns you when the two disagree; the only
                 * safe reading is that the typing is the newer intention.
                 */
                onChangeText={(t) => {
                  setBankSearch(t);
                  if (pickedBank) {
                    setPickedBank("");
                    setPickedBankCode("");
                    setResolvedName("");
                    setResolveFailed(false);
                  }
                }}
                onFocus={() => { setBankTyping(true); setBankSearch(""); }}
                placeholder="Bank name"
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                autoCapitalize="words"
              />
              {bankTyping ? (
                <TouchableOpacity
                  /* Dismissing the search restores nothing: if the bank was
                     cleared by typing, it stays cleared. */
                  onPress={() => { setBankTyping(false); setBankSearch(""); Keyboard.dismiss(); }}
                  hitSlop={14}
                >
                  <Feather name="x" size={15} color={colors.foreground} />
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={[ns.rule, { backgroundColor: colors.border }]} />

            {bankTyping ? (
              <>
                {suggestedBanks.length > 0 && (
                  <Text style={[ns.listLabel, { color: colors.mutedForeground }]}>SUGGESTED BANKS</Text>
                )}
                {suggestedBanks.map((b) => (
                  <BankRow key={`s-${b}`} bank={b} colors={colors} onPress={() => chooseBank(b)} />
                ))}

                {suggestedBanks.length > 0 && (
                  <Text style={[ns.listLabel, { color: colors.mutedForeground }]}>ALL BANKS</Text>
                )}
                {filteredBanks.map((b) => (
                  <BankRow key={b} bank={b} colors={colors} onPress={() => chooseBank(b)} />
                ))}

                {filteredBanks.length === 0 && (
                  <Text style={[ns.listEmpty, { color: colors.mutedForeground }]}>
                    No bank matches "{bankSearch.trim()}".
                  </Text>
                )}
              </>
            ) : (
              <>
            <View style={ns.field}>
              <Text style={[ns.fieldLabel, { color: colors.foreground }]}>Name</Text>
              <Text
                style={[
                  ns.fieldValue,
                  {
                    color: resolveFailed
                      ? colors.destructive
                      : resolvedName
                        ? colors.foreground
                        : colors.mutedForeground,
                  },
                ]}
                numberOfLines={1}
              >
                {resolveFailed
                  ? "Account not found"
                  : resolvedName || "Recipient name (auto-filled)"}
              </Text>
            </View>
            <View style={[ns.rule, { backgroundColor: colors.border }]} />

            <TextInput
              style={[ns.note, { color: colors.foreground }]}
              value={narration}
              onChangeText={setNarration}
              placeholder="Add narration"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={100}
            />
              </>
            )}
          </ScrollView>

          <View
            style={[
              ns.dock,
              {
                bottom: kbHeight,
                paddingBottom: kbHeight > 0 ? 12 : bottomPad + 14,
                backgroundColor: colors.background,
              },
            ]}
          >
            <View style={ns.saveRow}>
              <Text style={[ns.saveLabel, { color: colors.foreground }]}>Save beneficiary</Text>
              <Switch
                value={saveBeneficiary}
                onValueChange={setSaveBeneficiary}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.muted}
              />
            </View>
            <View style={[ns.rule, { backgroundColor: colors.border, marginBottom: 14 }]} />
            <TouchableOpacity
              style={[ns.cta, { backgroundColor: recipientReady ? colors.primary : colors.muted }]}
              disabled={!recipientReady}
              onPress={() => { Haptics.selectionAsync(); setStep("amount"); }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  ns.ctaText,
                  { color: recipientReady ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Continue
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <View style={ns.head}>
            <TouchableOpacity
              onPress={() => setStep("recipient")}
              style={[ns.headBtn, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              <Feather name="chevron-left" size={21} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[ns.headTitle, { color: colors.foreground }]}>Enter amount</Text>
            <View style={ns.headBtn} />
          </View>
          <View style={[ns.rule, { backgroundColor: colors.border }]} />

          <View style={ns.amountWrap}>
            <Text style={[ns.sendingCap, { color: colors.mutedForeground }]}>YOU ARE SENDING</Text>

            {/* Scale and shake ride the row, not the text, so the mark and the
                caret move with the digits rather than drifting against them. */}
            <Animated.View
              style={[
                ns.amountRow,
                {
                  transform: [
                    { scale: figScale },
                    {
                      translateX: figShake.interpolate({
                        inputRange: [-1, 0, 1],
                        outputRange: [-8, 0, 8],
                      }),
                    },
                  ],
                },
              ]}
            >
              {currency === "USD" ? (
                <Text
                  style={[
                    ns.bigAmount,
                    {
                      fontSize: figSize,
                      lineHeight: Math.round(figSize * 1.22),
                      color: over ? colors.destructive : numAmount > 0 ? colors.foreground : colors.mutedForeground,
                    },
                  ]}
                >
                  $
                </Text>
              ) : (
                /* A glyph, not a text character: the app's naira mark has a
                   crossbar the system font renders inconsistently, which at
                   this size reads as a struck-through N. */
                <Image
                  source={require("@/assets/images/nairaiconnew.png")}
                  style={[
                    ns.bigNaira,
                    {
                      width: markBox,
                      height: markBox,
                      tintColor: over ? colors.destructive : numAmount > 0 ? colors.foreground : colors.mutedForeground,
                    },
                  ]}
                />
              )}
              <Text
                style={[
                  ns.bigAmount,
                  {
                    fontSize: figSize,
                    lineHeight: Math.round(figSize * 1.22),
                    color: over ? colors.destructive : numAmount > 0 ? colors.foreground : colors.mutedForeground,
                  },
                ]}
                numberOfLines={1}
              >
                {figText}
              </Text>
              <Animated.View style={[ns.caret, { backgroundColor: colors.primary, opacity: caret }]} />
            </Animated.View>

            {/* One control instead of a value and a segmented switch beside
                it. The old pair put a filled neon pill next to the amount, so
                the brightest thing on the screen was the unit rather than the
                number - and "NGN | USD" never said that tapping converts what
                you have already typed. */}
            <TouchableOpacity
              style={[ns.swap, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => handleCurrencyChange(currency === "NGN" ? "USD" : "NGN")}
              disabled={usdNgn <= 0}
              activeOpacity={0.75}
            >
              <Text style={[ns.swapValue, { color: colors.mutedForeground }]}>
                {usdNgn > 0 && numAmount > 0
                  ? currency === "USD"
                    ? `≈ ₦${numAmount.toLocaleString()}`
                    : `≈ $${(numAmount / usdNgn).toFixed(2)}`
                  : currency === "USD"
                    ? "≈ ₦0"
                    : "≈ $0.00"}
              </Text>
              <Text style={[ns.swapDot, { color: colors.primary }]}>·</Text>
              <Text style={[ns.swapTo, { color: colors.primary }]}>
                switch to {currency === "NGN" ? "USD" : "NGN"}
              </Text>
            </TouchableOpacity>

                        {!!(amountError || limitError) && <Text style={ns.err}>{amountError || limitError}</Text>}
          </View>

          <View style={ns.amountDock}>
            <TouchableOpacity
              style={[ns.source, { backgroundColor: colors.card }]}
              activeOpacity={0.8}
              onPress={() => setShowAssetPicker(true)}
            >
              <TokenLogo symbol={selectedAsset} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[ns.sourceLabel, { color: colors.mutedForeground }]}>{balanceLabel}</Text>
                <Text style={[ns.sourceValue, { color: colors.foreground }]}>
                  ₦{maxNgn.toLocaleString()}
                </Text>
              </View>
              <Text style={[ns.change, { color: colors.primary }]}>Change</Text>
            </TouchableOpacity>

            <View style={ns.chips}>
              {/* Three amounts and the ceiling, in one row. A fixed amount you
                  cannot afford is dimmed rather than hidden, so the row does
                  not reflow under your thumb as the balance moves. */}
              {[1000, 5000, 10000].map((q) => {
                const affordable = ceiling >= q;
                return (
                  <TouchableOpacity
                    key={q}
                    style={[ns.chip, { backgroundColor: colors.card, opacity: affordable ? 1 : 0.4 }]}
                    disabled={!affordable}
                    onPress={() => {
                      Haptics.selectionAsync();
                      // Typed in whichever currency is on screen, so the figure
                      // that lands is the one the keypad would have produced.
                      handleAmountChange(
                        currency === "USD" && usdNgn > 0 ? (q / usdNgn).toFixed(2) : String(q),
                      );
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[ns.chipText, { color: colors.foreground }]}>
                      ₦{q.toLocaleString()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[ns.chip, { backgroundColor: colors.card, opacity: ceiling > 0 ? 1 : 0.4 }]}
                disabled={ceiling <= 0}
                onPress={() => {
                  Haptics.selectionAsync();
                  handleAmountChange(
                    currency === "USD" && usdNgn > 0
                      ? (ceiling / usdNgn).toFixed(2)
                      : String(Math.floor(ceiling)),
                  );
                }}
                activeOpacity={0.8}
              >
                <Text style={[ns.chipText, { color: colors.primary }]}>Max</Text>
              </TouchableOpacity>
            </View>

            <Keypad
              style={ns.pad}
              decimal
              onKey={(d) => handleAmountChange(display + d)}
              onBackspace={() => handleAmountChange(display.slice(0, -1))}
            />

            <TouchableOpacity
              style={[
                ns.cta,
                { marginTop: 12, marginBottom: bottomPad + 10, backgroundColor: amountReady ? colors.primary : colors.muted },
              ]}
              disabled={!amountReady}
              onPress={() =>
                goToSummary({
                  bankName: pickedBank,
                  accountNumber: acctNum,
                  accountName: resolvedName,
                  bankCode: pickedBankCode,
                })
              }
              activeOpacity={0.85}
            >
              <Text
                style={[
                  ns.ctaText,
                  { color: amountReady ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Continue
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <AccountScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPick={(found) => { setScannerOpen(false); applyScanResult(found); }}
      />

      {/* Who you have paid before. Opened from the account field, because
          that is the box you are staring at when you realise you do not want
          to type it again. */}
      {showPeople && (
        <Modal transparent animationType="slide" visible onRequestClose={() => setShowPeople(false)}>
          <Pressable style={ns.sheetOverlay} onPress={() => setShowPeople(false)}>
            <Pressable
              style={[ns.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[ns.sheetGrip, { backgroundColor: colors.border }]} />
              <View style={ns.sheetHead}>
                <Text style={[ns.sheetTitle, { color: colors.foreground, marginBottom: 0 }]}>
                  Send again
                </Text>
                {/* Only when there is something to edit, so the link does not
                    invite a mode with an empty list behind it. */}
                {people.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setEditingPeople((v) => !v);
                    }}
                    hitSlop={12}
                    activeOpacity={0.6}
                  >
                    <Text style={[ns.sheetLink, { color: colors.primary }]}>
                      {editingPeople ? "Done" : "Edit"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={[ns.tabs, { backgroundColor: colors.muted }]}>
                {(["recent", "beneficiary"] as const).map((t) => {
                  const on = acctTab === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[ns.tab, on && { backgroundColor: colors.card }]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setAcctTab(t);
                        // The other tab is a different list; carrying the mode
                        // across means arriving somewhere new already armed.
                        setEditingPeople(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          ns.tabText,
                          { color: on ? colors.foreground : colors.mutedForeground },
                        ]}
                      >
                        {t === "recent" ? "Recent" : "Beneficiaries"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <FlatList
                data={people}
                keyExtractor={(a) => a.id}
                style={{ maxHeight: 340 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[ns.empty, { color: colors.mutedForeground }]}>
                    {acctTab === "recent"
                      ? "Nobody yet. Accounts you send to will show up here."
                      : "No saved beneficiaries. Toggle Save beneficiary when you send."}
                  </Text>
                }
                renderItem={({ item }) => {
                  const logo = bankLogoSource(item.bankName);
                  return (
                    <TouchableOpacity
                      style={ns.person}
                      activeOpacity={editingPeople ? 1 : 0.7}
                      // Inert while editing. The minus sits where the chevron
                      // was, so a row that still paid somebody on a near miss
                      // would be the worst possible way to get this wrong.
                      disabled={editingPeople}
                      onPress={() => fillRecipient(item)}
                    >
                      <View style={[ns.personDisc, { backgroundColor: colors.muted }]}>
                        {logo ? (
                          <Image source={logo} style={ns.personLogo} resizeMode="contain" />
                        ) : (
                          <Feather name="user" size={17} color={colors.mutedForeground} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[ns.personName, { color: colors.foreground }]} numberOfLines={1}>
                          {item.accountName}
                        </Text>
                        <Text style={[ns.personSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {item.accountNumber} · {item.bankName}
                        </Text>
                      </View>
                      {editingPeople ? (
                        <TouchableOpacity
                          onPress={() => removePerson(item.id)}
                          hitSlop={10}
                          activeOpacity={0.7}
                          style={[ns.minus, { borderColor: colors.destructive + "55" }]}
                        >
                          <Feather name="minus" size={16} color={colors.destructive} />
                        </TouchableOpacity>
                      ) : (
                        <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Asset Picker Modal */}
      {showAssetPicker && (
        <Modal transparent animationType="slide" visible>
          {/* A Modal is its own window on iOS and is already resized for the
              keyboard; a KAV inside one counts that height twice. The sheet
              lifts itself by the measured height instead. */}
          <Pressable style={styles.modalOverlay} onPress={() => { setShowAssetPicker(false); setAssetSearch(""); }}>
            <Pressable style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: kbHeight > 0 ? kbHeight + 16 : bottomPad + 20 }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => { setShowAssetPicker(false); setAssetSearch(""); }}>
                  <Feather name="chevron-down" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Select asset</Text>
                <View style={{ width: 24 }} />
              </View>

              <View style={[styles.pickerSearch, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.pickerSearchInput, { color: colors.foreground }]}
                  placeholder="Search"
                  placeholderTextColor={colors.mutedForeground}
                  value={assetSearch}
                  onChangeText={setAssetSearch}
                />
              </View>

              <FlatList
                data={filteredOptions}
                keyExtractor={(item) => item.key}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[styles.pickerEmpty, { color: colors.mutedForeground }]}>
                    {assetSearch.trim()
                      ? `Nothing matches "${assetSearch.trim()}".`
                      : `You need at least ₦${MIN_SELL_NGN.toLocaleString()} of one asset to send to a bank.`}
                  </Text>
                }
                renderItem={({ item }) => {
                  const active =
                    selectedAsset === item.token && selectedChain?.tag === item.chain.tag;
                  return (
                    <TouchableOpacity
                      style={[
                        styles.assetListRow,
                        { borderBottomColor: colors.border, opacity: item.sellable ? 1 : 0.45 },
                      ]}
                      disabled={!item.sellable}
                      onPress={() => {
                        // Both halves of the choice, from the one tap.
                        setSelectedAsset(item.token);
                        setSelectedChain(item.chain);
                        setAmount("");
                        setDisplay("");
                        setAmountError("");
                        setShowAssetPicker(false);
                        setAssetSearch("");
                      }}
                    >
                      <View>
                        <TokenLogo symbol={item.token} size={40} dark />
                        {/* The network, on the coin it belongs to - the row is
                            a holding, so the two are one thing. */}
                        <Image
                          source={CHAIN_LOGOS[item.chain.tag]}
                          style={[styles.assetChainBadge, { borderColor: colors.card }]}
                        />
                      </View>
                      <View style={styles.assetListInfo}>
                        <View style={styles.assetNameRow}>
                          <Text style={[styles.assetListName, { color: colors.foreground }]}>
                            {item.name}
                          </Text>
                          {active && (
                            <Feather name="check" size={15} color={colors.primary} style={{ marginLeft: 5 }} />
                          )}
                        </View>
                        <Text style={[styles.assetListChain, { color: colors.mutedForeground }]}>
                          {/* The reason, on the row it applies to. Dimming
                              alone says "not this one" without saying why. */}
                          {item.sellable
                            ? item.chain.name
                            : `${item.chain.name} \u00b7 under the ₦${MIN_SELL_NGN.toLocaleString()} minimum`}
                        </Text>
                      </View>
                      <View style={styles.assetListRight}>
                        <Text style={[styles.assetListPrice, { color: colors.foreground }]}>
                          ₦{Math.floor(item.ngn).toLocaleString()}
                        </Text>
                        <Text style={[styles.assetListSub, { color: colors.mutedForeground }]}>
                          {item.balance.toFixed(item.token === "MOVE" ? 2 : 4)} {assetLabel(item.token)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Bank Selector Modal */}
    </View>
  );
}

function BankRow({
  bank,
  colors,
  onPress,
}: {
  bank: string;
  colors: any;
  onPress: () => void;
}) {
  const logo = bankLogoSource(bank);
  return (
    <TouchableOpacity style={ns.bankRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[ns.bankDisc, { backgroundColor: colors.muted }]}>
        {logo ? (
          <Image source={logo} style={ns.bankLogo} resizeMode="contain" />
        ) : (
          // Banks without artwork get the generic mark rather than a blank
          // square, so the column still lines up.
          <Feather name="home" size={16} color={colors.mutedForeground} />
        )}
      </View>
      <Text style={[ns.bankName, { color: colors.foreground }]} numberOfLines={1}>
        {bank}
      </Text>
    </TouchableOpacity>
  );
}

/** The two-step send layout. Kept apart from the old screen's styles. */
const ns = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
  headBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headTitle: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  // Edge to edge. The padding moved onto the rows themselves, so the rules
  // separate the whole width rather than floating inside a margin.
  rule: { height: StyleSheet.hairlineWidth },

  body: {},
  // A fixed label column, so To / Bank / Name line up however long the values
  // beside them run.
  field: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 58, paddingHorizontal: 20 },
  fieldLabel: { width: 52, fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_700Bold" },
  fieldInput: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium", padding: 0 },
  fieldValue: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium" },
  note: { minHeight: 72, fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular", paddingTop: 16, paddingHorizontal: 20, textAlignVertical: "top" },

  // Over the screen, not in the column: a footer that cannot change the
  // scroll view's height cannot collapse it either.
  dock: { position: "absolute", left: 0, right: 0, paddingHorizontal: 20, paddingTop: 10 },
  saveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  saveLabel: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  cta: { height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  // Centred as a column: caption, figure and pill share a centre line rather
  // than an edge. Every child hugs its own width, which is what lets three
  // different widths stack without any of them spanning the screen.
  amountWrap: { alignItems: "center", paddingTop: 30, paddingHorizontal: 20 },
  sendingCap: { fontSize: 10, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.5 },
  amountRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  // Sized from the figure at render, since the figure shrinks as it grows.
  bigNaira: { resizeMode: "contain", marginTop: 3, marginRight: 1 },
  bigAmount: { fontFamily: "Inter_800ExtraBold", letterSpacing: -1.6 },
  // Sized to the digits' cap height rather than the line box, so it sits with
  // the number instead of hanging below it.
  caret: { width: 3, height: 38, borderRadius: 2, marginLeft: 5 },

  swap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
  },
  swapValue: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  swapDot: { fontSize: 12.5, lineHeight: 17 },
  swapTo: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold" },

  err: { color: "#ef4444", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 10, textAlign: "center" },

  amountDock: { marginTop: "auto", paddingHorizontal: 20 },
  source: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18 },
  sourceLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  sourceValue: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3, marginTop: 1 },
  change: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },
  chips: { flexDirection: "row", gap: 6, marginTop: 14 },
  // Four across, so the row gives up a little padding and type size to fit
  // "₦10,000" without truncating it.
  chip: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12 },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  pad: { marginTop: 16 },
  scanMark: { width: 17, height: 17, resizeMode: "contain" },

  listLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.3,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  bankRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 20, paddingVertical: 9 },
  bankDisc: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  bankLogo: { width: 26, height: 26 },
  bankName: { flex: 1, fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_500Medium" },
  listEmpty: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 34, paddingHorizontal: 24 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10 },
  sheetGrip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 18 },
  sheetTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, paddingHorizontal: 4, marginBottom: 14 },
  // A segmented control rather than underlined tabs: two options, and the
  // filled half says which list you are looking at without a second cue.
  tabs: { flexDirection: "row", padding: 4, borderRadius: 999, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: "center" },
  tabText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },
  empty: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 34, paddingHorizontal: 24 },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  sheetLink: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  // Outlined rather than filled: it is destructive, but it is also the only
  // coloured thing on a list of grey rows, and a row of red discs reads as an
  // alarm rather than a list you are tidying.
  minus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  person: { flexDirection: "row", alignItems: "center", gap: 13, padding: 12, borderRadius: 16 },
  personDisc: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  personLogo: { width: 30, height: 30 },
  personName: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  personSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLogo: { width: 32, height: 32, borderRadius: 16 },
  content: { paddingHorizontal: 20 },

  /* Selector pills */
  pillRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 20, flexWrap: "wrap", justifyContent: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    height: 44,
  },
  assetPill: { gap: 8 },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chainPillLogo: { width: 20, height: 20, borderRadius: 10 },

  /* Big amount */
  bigAmountWrap: { alignItems: "center", marginBottom: 24 },
  bigAmountRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bigAmountInput: { fontSize: 56, fontFamily: "Inter_700Bold", minWidth: 60, textAlign: "center" },
  bigSymbol: { fontSize: 20, fontFamily: "Inter_600SemiBold", marginLeft: 6, marginTop: 8 },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 },
  balanceText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  maxBtnInline: { fontSize: 13, fontFamily: "Inter_700Bold" },
  cryptoEquivRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  cryptoEquivText: { fontSize: 14, fontFamily: "Inter_400Regular", marginLeft: 6 },
  errorText: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" },

  /* Sell button */
  sellBtn: { height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  sellBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Send-to section */
  sendToSection: { marginTop: 8 },
  sendToTitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8, color: "#999" },

  /* Account number field */
  acctNumField: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 44, gap: 8 },
  acctNumInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", height: 44 },

  // Sits on the coin, ringed in the sheet's own colour so it reads as attached
  // rather than as a second, smaller coin.
  assetChainBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
  },
  pickerEmpty: {
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
    paddingVertical: 40,
  },

  /* Resolved recipient card */
  recipientCard: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: 10, gap: 10 },
  recipientIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  recipientLogo: { width: 36, height: 36, borderRadius: 18 },
  recipientLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: 2 },
  recipientName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Resolving row */
  resolvingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, marginTop: 8 },

  /* Bank section label */
  bankSectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, textTransform: "uppercase" as any, letterSpacing: 0.5 },

  /* Divider */
  divider: { height: 1, marginVertical: 16 },

  tabRow: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 12 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  acctRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  acctAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  acctLogo: { width: 42, height: 42, borderRadius: 21 },
  acctInitial: { fontSize: 17, fontFamily: "Inter_700Bold" },
  acctInfo: { flex: 1 },
  acctName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  acctSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyWrap: { alignItems: "center", paddingVertical: 32, gap: 6 },
  emptyText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  /* Bank list in modal */
  bankListRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  bankFallback: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  bankLogo: { width: 28, height: 28, borderRadius: 14 },
  bankListName: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  pickerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  pickerSearch: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    marginBottom: 16,
  },
  pickerSearchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },

  /* Asset list */
  assetListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  assetListInfo: { flex: 1 },
  assetNameRow: { flexDirection: "row", alignItems: "center" },
  assetListName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  assetChainRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  assetChainLogo: { width: 16, height: 16, borderRadius: 8, marginLeft: -4, borderWidth: 1.5, borderColor: "#1a1a1a" },
  assetListChain: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 4 },
  assetListRight: { alignItems: "flex-end" },
  assetListPrice: { fontSize: 14, fontFamily: "Inter_700Bold" },
  assetListSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Chain picker */
  chainPickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chainPickLogo: { width: 36, height: 36, borderRadius: 18 },
  chainPickName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
