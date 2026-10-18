import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { AppState, AppStateStatus, InteractionManager, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loginUser,
  registerUser,
  logoutUser,
  getMe,
  setUserPin,
  verifyUserPin,
  toggleBiometric,
  verifyEmail as verifyEmailApi,
  resendVerification as resendVerificationApi,
  authenticateWithDynamic,
  type AuthUser,
} from "@/services/auth";
import { getAccessToken, clearTokens } from "@/services/api";
import { onSessionEnded, takeSessionEndReason } from "@/services/session";
import { router } from "expo-router";
import { initializeWallets, saveWalletAddresses, hasWalletAddresses, saveWalletType, syncBalances } from "@/services/wallet";
import { getTransactions as fetchTransactions } from "@/services/transactions";
import { fetchOnChainBalances } from "@/services/balances";
import {
  createMnemonic,
  deriveAddresses,
  formatAddressesForSave,
  saveMnemonic,
  loadMnemonic,
  deleteMnemonic,
  hasLocalWallet,
  isValidMnemonic,
  setActiveUserId,
  getLocalAddresses,
  loadTonAddress,
  saveEmbeddedKey,
  loadEmbeddedKey,
  deriveAddressesFromEmbedded,
  setWalletType as setLocalWalletType,
  clearLocalWallet,
  saveDynamicAddresses,
  loadDynamicAddresses,
  type EmbeddedKeyBundle,
  type WalletType,
} from "@/services/wallet-core";
import { createBackup, restoreFromBackup } from "@/services/wallet-backup";
import {
  getSavingsLocks,
  prepareSavingsLock,
  submitSavingsLock,
  prepareSavingsWithdraw,
  submitSavingsWithdraw,
  prepareSavingsAddToLock,
  submitSavingsAddToLock,
} from "@/services/savings";
import { signMovementTransaction } from "@/services/wallet-core";
import { updateProfile } from "@/services/user";
import { getRates, type RatesResponse } from "@/services/rates";
// Static import — Expo's async-require cannot resolve dynamic import() in the
// dev client, which made every Dynamic wallet call fail before it ran.
import {
  getDynamicWalletAddresses,
  probeTonWallet,
  isDynamicAuthenticated,
  dynamicLogout,
} from "@/services/dynamic-wallet";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  username: string;
  verified: boolean;
  emailVerified: boolean;
  loginVerified: boolean;
  referralCode: string;
  pinSet: boolean;
  bioEnabled: boolean;
  /** Username hidden from other people on the leaderboard and in transfers. */
  anonMode: boolean;
  kycStatus: string;
  avatarUrl: string | null;
  walletType: WalletType | null;
  /** When the account was created. Absent on responses from older servers. */
  createdAt?: string;
  /** Whether a friend's referral code can still be added (first 7 days, no referrer yet). */
  referralClaim?: { open: boolean; daysLeft: number };
}

interface Transaction {
  id: string;
  type: string;
  asset: string;
  chain: string | null;
  amount: number;
  fee: number | null;
  status: string;
  reference: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

interface SavingsPlan {
  id: string;
  asset: string;
  chain: string;
  amount: number;
  fee: number;
  durationDays: number;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
  txHash?: string;
  name?: string;
}

interface AppContextType {
  user: User | null;
  isLoggedIn: boolean;
  isReady: boolean;
  isPinSet: boolean;
  usdcBalance: number;
  usdtBalance: number;
  usdcxBalance: number;
  cngnBalance: number;
  ethBalance: number;
  moveBalance: number;
  solBalance: number;
  ngnBalance: number;
  transactions: Transaction[];
  savings: SavingsPlan[];
  login: (email: string, password: string) => Promise<void>;
  /**
   * Signs in with a Dynamic JWT and reports whether the account already has a
   * PIN, so the caller can route to the right screen itself rather than through
   * "/" - see app/auth/dynamic-onboarding.tsx for why that matters.
   */
  authenticateDynamic: (token: string, referralCode?: string) => Promise<{ pinSet: boolean }>;
  logout: () => void;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  register: (data: Partial<User> & { password: string }) => Promise<void>;
  connectWallet: () => Promise<void>;
  walletType: WalletType | null;
  finishWalletSetup: (type: WalletType, bundle?: EmbeddedKeyBundle) => Promise<void>;
  walletReady: boolean;
  hasWallet: boolean;
  walletError: string | null;
  retryWalletSetup: () => Promise<void>;
  walletAddresses: Record<string, string>;
  walletBalances: { asset: string; chain: string; balance: number }[];
  verifyEmail: (code: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  addSavings: (plan: { asset: string; chain: string; amount: number; durationDays: number; name?: string }) => Promise<{ amount: number; fee: number; txHash: string }>;
  withdrawSavings: (id: string) => Promise<void>;
  addToLock: (id: string, amount: number) => Promise<{ amount: number; fee: number; txHash: string }>;
  refreshBalances: (silent?: boolean) => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshSavings: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (fields: Partial<User>) => Promise<void>;
  bioLogin: boolean;
  setBioLogin: (v: boolean) => Promise<void>;
  bioTx: boolean;
  setBioTx: (v: boolean) => Promise<void>;
  balancesLoading: boolean;
  rates: RatesResponse | null;
  refreshRates: () => Promise<void>;
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
  /**
   * Which signed-in session this is - up by one each time the app is unlocked,
   * by PIN, by Face ID or straight after sign-in.
   *
   * For anything that should happen once when someone comes in and not again
   * until they come in next. Navigation does not change it, so a screen cannot
   * make it happen again by remounting.
   */
  sessionId: number;
}

const AppContext = createContext<AppContextType | null>(null);

const CACHED_USER_KEY = "@cachedUser";

function mapAuthUser(u: AuthUser): User {
  return {
    id: u.id,
    firstName: u.firstName || "",
    lastName: u.lastName || "",
    email: u.email,
    phone: u.phone || "",
    username: u.username || "",
    verified: u.kycStatus === "VERIFIED",
    emailVerified: u.emailVerified,
    // Default to true for older server responses that don't yet send this
    // field so existing clients don't get stuck on the verify screen.
    loginVerified: u.loginVerified !== false,
    referralCode: u.referralCode || "",
    pinSet: u.pinSet,
    bioEnabled: u.bioEnabled,
    // Older servers do not send it, and "not hidden" is the right default to
    // show for them because it is what those servers actually do.
    anonMode: u.anonMode === true,
    kycStatus: u.kycStatus,
    avatarUrl: u.avatarUrl,
    walletType: u.walletType ?? null,
    createdAt: u.createdAt,
    // Closed unless the server says open: a prompt to add a code that then
    // leads to nothing is worse than no prompt.
    referralClaim: u.referralClaim?.open
      ? { open: true, daysLeft: u.referralClaim.daysLeft }
      : { open: false, daysLeft: 0 },
  };
}

/**
 * Whether to ask Dynamic for a TON wallet on launch.
 *
 * Off: Dynamic refuses it on this SDK and the attempt only prints an error.
 * Turn it on to re-test after Dynamic support has looked at it.
 */
const PROBE_TON_WALLET = false;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // Read by the session-ended handler, which is registered once.
  const isLoggedInRef = useRef(false);
  isLoggedInRef.current = isLoggedIn;
  const loggingOutRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [isPinSet, setIsPinSet] = useState(false);
  const [unlocked, setUnlockedState] = useState(false);
  const [sessionId, setSessionId] = useState(0);
  // Unlocking begins a session. Locking or logging out ends one and starts
  // nothing, so the count only moves on the way in.
  const setUnlocked = useCallback((v: boolean) => {
    setUnlockedState(v);
    if (v) setSessionId((n) => n + 1);
  }, []);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [usdtBalance, setUsdtBalance] = useState(0);
  const [usdcxBalance, setUsdcxBalance] = useState(0);
  const [ethBalance, setEthBalance] = useState(0);
  const [moveBalance, setMoveBalance] = useState(0);
  const [solBalance, setSolBalance] = useState(0);
  const [cngnBalance, setCngnBalance] = useState(0);
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const ngnBalance = useMemo(() => {
    if (!rates) return 0;
    // USDCx is 1:1 USDC, so reuse the USDC ngn rate for NGN valuation.
    return (
      usdcBalance * rates.USDC.ngn +
      usdtBalance * rates.USDT.ngn +
      usdcxBalance * rates.USDC.ngn +
      moveBalance * rates.MOVE.ngn +
      solBalance * rates.SOL.ngn +
      // Its own rate, not par. cNGN trades a little under the naira, so
      // counting it at 1.00 would overstate the balance it is part of.
      cngnBalance * (rates.cNGN?.ngn || 0)
    );
  }, [usdcBalance, usdtBalance, usdcxBalance, moveBalance, solBalance, cngnBalance, rates]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savings, setSavings] = useState<SavingsPlan[]>([]);
  const [bioLogin, setBioLoginState] = useState(false);
  const [bioTx, setBioTxState] = useState(false);
  const [walletReady, setWalletReady] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
  const [walletBalances, setWalletBalances] = useState<{ asset: string; chain: string; balance: number }[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const walletCreatingRef = useRef(false);
  const walletBalancesRef = useRef<{ asset: string; chain: string; balance: number }[]>([]);
  const addressCacheRef = useRef<Record<string, string> | null>(null);

  // ─── Data fetchers ─────────────────────────────────────────
  const refreshRates = useCallback(async () => {
    try {
      const data = await getRates();
      setRates(data);
    } catch {}
  }, []);

  const refreshBalances = useCallback(async (silent = false) => {
    if (!silent) setBalancesLoading(true);

    /**
     * Ask the server to reconcile its own view of the chain.
     *
     * Balances are read straight from the chain on device, which is why a
     * deposit shows up in the balance immediately. But only the server can
     * write a Transaction row, and it compares its last known balance against
     * the chain to spot money that arrived from outside the app. Nothing was
     * calling it on native - the sync only ran on web, where RPCs are proxied -
     * so external deposits raised the balance and were never recorded.
     *
     * Deliberately not on the silent path: that runs every 15 seconds, and this
     * makes the server re-read every chain. Initial load and pull-to-refresh
     * are enough, and the foreground handler below covers coming back to the app.
     */
    if (!silent) syncBalances().catch(() => {});
    try {
      // Use cached addresses — derive only once per session
      let addresses = addressCacheRef.current;
      if (!addresses) {
        addresses = await getLocalAddresses();
        if (!addresses) return;
        addressCacheRef.current = addresses;
        setWalletAddresses(addresses);
      }

      /**
       * TON arrives a beat later than the rest, on a first run.
       *
       * Every other address is derived on the device, so the cache above has
       * them immediately. TON's comes from the server - it is the hash of a
       * wallet contract rather than of the key, which the app has no library
       * to compute - and the sync that fetches it is fired above without being
       * waited for. So on a fresh install this cache can be built one tick
       * before the address exists, and would then hold no TON for the rest of
       * the session: no balance, and a deposit screen with nothing to show.
       *
       * Cheap to re-check: a single storage read, and only until it lands.
       */
      if (!addresses.TON) {
        const tonAddress = await loadTonAddress();
        if (tonAddress) {
          addresses = { ...addresses, TON: tonAddress };
          addressCacheRef.current = addresses;
          setWalletAddresses(addresses);
        }
      }

      // Fetch balances directly from on-chain RPCs
      // Pass current balances so failed RPCs keep last-known values
      const { totals, balances } = await fetchOnChainBalances(addresses, walletBalancesRef.current);

      // Skip state updates if nothing changed — avoids unnecessary re-renders
      const prev = walletBalancesRef.current;
      const changed = balances.length !== prev.length ||
        balances.some((b, i) => b.balance !== prev[i]?.balance || b.asset !== prev[i]?.asset || b.chain !== prev[i]?.chain);

      if (changed) {
        setUsdcBalance(totals["USDC"] || 0);
        setUsdtBalance(totals["USDT"] || 0);
        setUsdcxBalance(totals["USDCx"] || 0);
        setEthBalance(totals["ETH"] || 0);
        setMoveBalance(totals["MOVE"] || 0);
        setSolBalance(totals["SOL"] || 0);
        setCngnBalance(totals["cNGN"] || 0);
        setWalletBalances(balances);
        walletBalancesRef.current = balances;
      }
    } catch (err) {
      console.error("[BALANCES] On-chain fetch error:", err);
    } finally {
      if (!silent) setBalancesLoading(false);
    }
  }, []);

  const refreshTransactions = useCallback(async () => {
    try {
      const { transactions: txs } = await fetchTransactions({ limit: 50 });
      setTransactions(
        txs.map((t) => ({
          ...t,
          amount: Number(t.amount),
          fee: t.fee != null ? Number(t.fee) : null,
        }))
      );
    } catch {}
  }, []);

  const refreshSavings = useCallback(async () => {
    try {
      const { locks } = await getSavingsLocks({ limit: 50 });
      setSavings(
        locks.map((l) => ({
          id: l.id,
          asset: l.asset,
          chain: l.chain,
          amount: Number(l.amount),
          fee: Number(l.fee || 0),
          durationDays: l.durationDays,
          startDate: l.lockedAt,
          endDate: l.unlocksAt,
          status: l.status,
          createdAt: l.lockedAt,
          txHash: l.txHash,
          name: l.name,
        }))
      );
    } catch (e) {
      console.error("[refreshSavings] failed:", e);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    await Promise.all([refreshBalances(), refreshTransactions(), refreshSavings(), refreshRates()]);
  }, [refreshBalances, refreshTransactions, refreshSavings, refreshRates]);

  // ─── Wallet: generate & persist BIP-39 mnemonic ───────────────
  const connectWallet = useCallback(async () => {
    // Mutex: prevent concurrent wallet creation
    if (walletCreatingRef.current) return;
    walletCreatingRef.current = true;
    try {
      /**
       * Restores a 12-word wallet. Never makes one.
       *
       * This used to mint a fresh mnemonic whenever the device had none, which
       * turned every caller into a wallet factory - including the "Create new"
       * button on the recovery modal, and anything that reached here because
       * the Dynamic wallet had failed to arrive. A failure to create the right
       * wallet must not quietly produce the wrong kind.
       *
       * Loading an existing one stays, so people who already hold a mnemonic
       * keep working and can still read their phrase out.
       */
      const mnemonic = await loadMnemonic();
      const isExisting = true;
      if (!mnemonic) {
        throw new Error(
          "NO_WALLET_ON_DEVICE: this device has no wallet to restore. Sign in with email to get one.",
        );
      }

      // Derive addresses from mnemonic
      const addresses = deriveAddresses(mnemonic);
      const formatted = formatAddressesForSave(addresses);

      // Initialize wallets in backend if first time
      try { await initializeWallets(); } catch {}

      // Save public addresses to server (server never sees mnemonic)
      await saveWalletAddresses(formatted);

      // Persist mnemonic on device (only needed if newly created)
      if (!isExisting) {
        await saveMnemonic(mnemonic);
      }

      setWalletReady(true);
      setHasWallet(true);
      console.log("✅ Wallet ready (BIP-39 client-side)");
    } finally {
      walletCreatingRef.current = false;
    }
  }, []);

  // Create the wallet the user chose in the chooser (email vs 12-word), or
  // restore an embedded wallet on a new device. Persists the key locally,
  // pushes addresses to the backend, and records the wallet type both places.
  const finishWalletSetup = useCallback(
    async (type: WalletType, bundle?: EmbeddedKeyBundle) => {
      if (type === "EMBEDDED") {
        if (!bundle) throw new Error("NO_EMBEDDED_KEY");
        await saveEmbeddedKey(bundle);
        await setLocalWalletType("EMBEDDED");
        const addr = deriveAddressesFromEmbedded(bundle);
        try { await initializeWallets(); } catch {}
        // Server addresses are immutable once set, so this saves them on a fresh
        // wallet and is a harmless no-op on recovery (they already match).
        try { await saveWalletAddresses(formatAddressesForSave(addr)); } catch {}
        setWalletReady(true);
        setHasWallet(true);
      } else {
        await setLocalWalletType("MNEMONIC");
        await connectWallet();
      }
      try { await saveWalletType(type); } catch {}
      setUser((prev) => (prev ? { ...prev, walletType: type } : prev));
      loadAllData();
    },
    [connectWallet, loadAllData]
  );

  useEffect(() => {
    loadStoredData();
  }, []);

  // Initial data load. On native, defer until the user passes the PIN lock
  // screen (`unlocked`) — fetching balances (which derives wallet keys + makes
  // on-chain RPC calls on the JS thread), transactions, savings and rates while
  // the lock screen is up congests the thread on cold start and makes the first
  // PIN taps feel laggy. The lock screen shows none of that data anyway. Web has
  // no lock screen, so load as soon as the session is ready there.
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn || !isReady) return;
    if (Platform.OS !== "web" && !unlocked) return;
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    loadAllData();
  }, [isLoggedIn, isReady, unlocked, loadAllData]);

  // Auto-refresh rates every 10 min while logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(refreshRates, 600_000);
    return () => clearInterval(interval);
  }, [isLoggedIn, refreshRates]);

  // Auto-refresh balances every 15s while unlocked & wallet ready (silent — no loading spinner)
  // Wrapped in InteractionManager so polling never interrupts touches/animations
  useEffect(() => {
    if (!unlocked || !walletReady) return;
    // Fetch immediately on unlock, then poll
    refreshBalances(true);
    const interval = setInterval(() => {
      InteractionManager.runAfterInteractions(() => refreshBalances(true));
    }, 15_000);
    return () => clearInterval(interval);
  }, [unlocked, walletReady, refreshBalances]);

  // Refresh balances when app comes back to foreground (silent)
  useEffect(() => {
    if (!unlocked || !walletReady) return;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        // Catches deposits that landed while the app was in the background.
        syncBalances().catch(() => {});
        InteractionManager.runAfterInteractions(() => refreshBalances(true));
      }
    });
    return () => sub.remove();
  }, [unlocked, walletReady, refreshBalances]);

  // Shared wallet bootstrap — runs only when the session is loginVerified
  // (the /wallet/* endpoints reject unverified-login sessions with 401).
  const setupWalletAfterAuth = useCallback(async () => {
    try {
      /**
       * Parked. Flip PROBE_TON_WALLET when Dynamic answers.
       *
       * It has already told us what it can: Dynamic refuses
       * createWallet({ chains: ["Ton"] }) with invalid_chains, "not enabled
       * for embedded wallets", even though TON is switched on in both the
       * chain list and the embedded-wallet settings, the environment id
       * matches and mainnet -239 is configured. That is theirs to explain,
       * and until they do this only prints a red error on every dev launch.
       *
       * Left in place rather than deleted because the question is still open
       * and worth re-asking: a Dynamic TON wallet would come with a real
       * recovery phrase, which is the one thing our own derivation cannot
       * have. Dev only either way - a shipped build never ran it.
       */
      if (__DEV__ && PROBE_TON_WALLET) probeTonWallet().catch(() => {});

      // 0) Dynamic (email) wallet — cached addresses are the source of truth.
      const dynAddr = await loadDynamicAddresses();
      if (dynAddr) {
        try { await initializeWallets(); } catch {}
        try { await saveWalletAddresses(formatAddressesForSave(dynAddr)); } catch {}
        setHasWallet(true);
        setWalletReady(true);
        return;
      }

      // 0b) Signed into Dynamic but no cached addresses — e.g. wallet creation
      //     failed mid-onboarding. Self-heal by re-deriving from Dynamic so the
      //     user isn't left wallet-less.
      try {
        if (isDynamicAuthenticated()) {
          // Fire-and-forget: wallet creation can be slow or fail, and this runs
          // during app start. Awaiting it here gated isReady and froze the UI.
          (async () => {
            try {
              const addr = await getDynamicWalletAddresses();
              await saveDynamicAddresses(addr);
              await setLocalWalletType("EMBEDDED");
              try { await initializeWallets(); } catch {}
              try { await saveWalletAddresses(formatAddressesForSave(addr)); } catch {}
              try { await saveWalletType("EMBEDDED"); } catch {}
              setUser((prev) => (prev ? { ...prev, walletType: "EMBEDDED" } : prev));
              setHasWallet(true);
              setWalletReady(true);
            } catch (e: any) {
              console.warn("[dynamic] background wallet setup failed:", e?.message || e);
              setWalletError(String(e?.message || e));
            }
          })();
          return;
        }
      } catch (e: any) {
        console.warn("[dynamic] wallet self-heal skipped:", e?.message || e);
        if (e?.stack) console.warn("[dynamic] self-heal stack:", String(e.stack).slice(0, 800));
      }

      // 1) An embedded (email) key on device is the source of truth. Reconcile
      //    everything from it and mark ready — this self-heals a creation that
      //    got interrupted (e.g. Android cold-restarting the app after the login
      //    redirect), so the home screen never flashes chooser/recovery modals.
      const embeddedKey = await loadEmbeddedKey();
      if (embeddedKey) {
        const addr = deriveAddressesFromEmbedded(embeddedKey);
        try { await initializeWallets(); } catch {}
        try { await saveWalletAddresses(formatAddressesForSave(addr)); } catch {}
        try { await saveWalletType("EMBEDDED"); } catch {}
        await setLocalWalletType("EMBEDDED");
        setUser((prev) => (prev ? { ...prev, walletType: "EMBEDDED" } : prev));
        setHasWallet(true);
        setWalletReady(true);
        return;
      }

      // 2) Mnemonic path. Never assume "no wallet" (and never create) on a
      //    failed/timed-out backend check — trust local state instead.
      const hasLocal = await hasLocalWallet();
      let hasAddr: boolean;
      try {
        hasAddr = await hasWalletAddresses();
      } catch {
        if (hasLocal) { setWalletReady(true); setHasWallet(true); }
        return;
      }
      setHasWallet(hasAddr);
      if (hasLocal && hasAddr) {
        setWalletReady(true);
      } else if (hasAddr && !hasLocal) {
        // Server has addresses but device has no key — WalletRecoveryModal appears.
      } else {
        // Genuinely no wallet (fresh signup / post-deletion) — the chooser handles it.
      }
      try { await initializeWallets(); } catch {}
    } catch (e: any) {
      console.warn("Wallet bootstrap error:", e?.message);
    }
  }, []);

  const loadStoredData = async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        try {
          const { user: authUser } = await getMe();
          const mapped = mapAuthUser(authUser);
          setUser(mapped);
          setIsLoggedIn(true);
          setIsPinSet(authUser.pinSet);
          // Cache user data so we can restore session without network
          await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(mapped));
          // Set active user so wallet-core reads the right mnemonic
          await setActiveUserId(authUser.id);
          // Wallet endpoints require a loginVerified session — skip if user is mid-onboarding.
          // verifyEmailHandler will run setupWalletAfterAuth() once verification completes.
          if (mapped.loginVerified) {
            await setupWalletAfterAuth();
          }
          // Data loading is deferred to the effect above (runs after unlock on
          // native / immediately on web) so it doesn't congest the PIN screen.
        } catch (authErr: any) {
          // getMe() failed (token expired, network error, etc.)
          const is401 = authErr?.response?.status === 401 || authErr?.message?.includes("401");

          // A 401 here means the refresh interceptor already tried and failed,
          // so the session is genuinely dead - on native too. Restoring from
          // cache in that case puts the user on a PIN screen for a session that
          // cannot work: the PIN is accepted locally, then every call 401s.
          // Offline tolerance below is for network failures, not for a server
          // that answered and said no.
          if (is401) {
            console.warn("[SESSION] Auth tokens invalid — forcing re-login");
            await clearTokens();
            await AsyncStorage.removeItem(CACHED_USER_KEY);
          } else {
            // Native: Try to restore from cached user data so user gets PIN screen, not login
            const cached = await AsyncStorage.getItem(CACHED_USER_KEY);
            if (cached) {
              try {
                const cachedUser: User = JSON.parse(cached);
                // Back-compat: older builds didn't persist loginVerified. Treat
                // missing-as-verified so upgraders with working sessions aren't
                // bounced to the verify-email screen.
                if (cachedUser.loginVerified === undefined) cachedUser.loginVerified = true;
                // We reach here only because getMe() failed (offline / cold-start
                // hiccup) — the verify-email screen needs the server too, so it's
                // a dead-end for an already-email-verified user. Send them to the
                // PIN screen instead; PIN verify is a live server call that will
                // reject the session if it's genuinely not login-verified.
                if (cachedUser.emailVerified) cachedUser.loginVerified = true;
                setUser(cachedUser);
                setIsLoggedIn(true);
                setIsPinSet(cachedUser.pinSet);
                await setActiveUserId(cachedUser.id);
                // Check wallet locally (don't hit network)
                const hasLocal = await hasLocalWallet();
                if (hasLocal) {
                  setWalletReady(true);
                  setHasWallet(true);
                }
                // Don't clear tokens — PIN verify or refresh may still work
              } catch {
                // Cached data corrupt — fall through to login
                await clearTokens();
                await AsyncStorage.removeItem(CACHED_USER_KEY);
              }
            } else if (authErr?.response?.status !== 426) {
              // A 426 is this build being too old, not the session being bad.
              // The update screen is up by now, and clearing here would sign
              // them out of the version they are about to install.
              await clearTokens();
            }
          }
        }
      }
      const bl = await AsyncStorage.getItem("@bioLogin");
      if (bl === "true") setBioLoginState(true);
      const bt = await AsyncStorage.getItem("@bioTx");
      if (bt === "true") setBioTxState(true);
    } catch (e) {}
    setIsReady(true);
  };

  const login = async (email: string, password: string) => {
    const data = await loginUser(email, password);
    const mapped = mapAuthUser(data.user);
    setUser(mapped);
    setIsLoggedIn(true);
    setIsPinSet(mapped.pinSet);
    await restoreDevicePrefs();
    // Cache user data for session restoration
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(mapped));
    // Set active user so wallet-core reads the right mnemonic
    await setActiveUserId(data.user.id);
    // Wallet setup is deferred until after email verification — the session is
    // not yet loginVerified, so /wallet/* endpoints would 401. See verifyEmailHandler.
  };

  // ─── Email-only login via Dynamic.xyz ───────────────────────
  // `token` is the verified Dynamic JWT from the onboarding screen. We exchange
  // it for our session (the session is login-verified immediately — Dynamic did
  // the OTP), then set up the Dynamic embedded wallet: derive addresses, cache
  // them locally (for balances) and push them to the backend.
  const authenticateDynamic = async (token: string, referralCode?: string): Promise<{ pinSet: boolean }> => {
    const data = await authenticateWithDynamic(token, referralCode);
    const mapped = mapAuthUser(data.user);
    setUser(mapped);
    setIsLoggedIn(true);
    setIsPinSet(mapped.pinSet);
    // Biometric preferences are device settings, not session state. Logout
    // clears them from memory, so without this a logout/login round trip in the
    // same app session leaves bioLogin false and the PIN screen never offers
    // Face ID.
    await restoreDevicePrefs();
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(mapped));
    await setActiveUserId(data.user.id);

    const setupDynamicWallet = async (userId: string) => {
      const addr = await getDynamicWalletAddresses();
      await saveDynamicAddresses(addr, userId);
      await setLocalWalletType("EMBEDDED", userId);
      try { await initializeWallets(); } catch {}
      try { await saveWalletAddresses(formatAddressesForSave(addr)); } catch {}
      try { await saveWalletType("EMBEDDED"); } catch {}
      setUser((prev) => (prev ? { ...prev, walletType: "EMBEDDED" } : prev));
      setWalletError(null);
      setWalletReady(true);
      setHasWallet(true);
    };

    try {
      await setupDynamicWallet(data.user.id);
    } catch (e: any) {
      console.warn("[dynamic] wallet setup failed:", e?.message || e);
      setWalletError(String(e?.message || e));
      // The WaaS signed session occasionally needs a beat right after OTP —
      // retry once before falling through (home self-heals on next launch).
      try {
        await new Promise((r) => setTimeout(r, 2000));
        await setupDynamicWallet(data.user.id);
      } catch (e2: any) {
        console.warn("[dynamic] wallet setup retry failed:", e2?.message || e2);
        setWalletError(String(e2?.message || e2));
      }
    }

    // Read off the server response rather than the state we just set: a
    // setState is not readable by the caller on the next line.
    return { pinSet: mapped.pinSet };
  };

  // Re-attempt Dynamic wallet creation on demand (surfaced on the home screen
  // when the wallet is unavailable).
  const retryWalletSetup = async () => {
    setWalletError(null);
    try {
      const addr = await getDynamicWalletAddresses();
      await saveDynamicAddresses(addr);
      await setLocalWalletType("EMBEDDED");
      try { await initializeWallets(); } catch {}
      try { await saveWalletAddresses(formatAddressesForSave(addr)); } catch {}
      try { await saveWalletType("EMBEDDED"); } catch {}
      setUser((prev) => (prev ? { ...prev, walletType: "EMBEDDED" } : prev));
      setWalletReady(true);
      setHasWallet(true);
      loadAllData();
    } catch (e: any) {
      const msg = String(e?.message || e);
      console.warn("[dynamic] manual wallet retry failed:", msg);
      setWalletError(msg);
      throw e;
    }
  };

  /** Re-read device-level preferences that logout clears from memory. */
  const restoreDevicePrefs = async () => {
    try {
      const bl = await AsyncStorage.getItem("@bioLogin");
      setBioLoginState(bl === "true");
      const bt = await AsyncStorage.getItem("@bioTx");
      setBioTxState(bt === "true");
    } catch {}
  };

  const logout = async () => {
    loggingOutRef.current = true;
    // Revoking the session server-side is best-effort. It was awaited bare, so
    // a failure (already-expired token, no network) threw before any of the
    // state below ran and left the app half-logged-in - still holding a user,
    // a PIN flag and an unlocked session.
    try {
      await logoutUser();
    } catch {}
    try {
      await dynamicLogout();
    } catch {}
    await AsyncStorage.removeItem(CACHED_USER_KEY);
    setIsLoggedIn(false);
    setUser(null);
    setIsPinSet(false);
    setUnlocked(false);
    initialLoadDoneRef.current = false;
    addressCacheRef.current = null;
    setWalletReady(false);
    setHasWallet(false);
    // Reset all account-specific data
    setUsdcBalance(0);
    setUsdtBalance(0);
    setUsdcxBalance(0);
    setEthBalance(0);
    setMoveBalance(0);
    setSolBalance(0);
    setCngnBalance(0);
    setRates(null);
    setTransactions([]);
    setSavings([]);
    setWalletBalances([]);
    walletBalancesRef.current = [];
    setWalletAddresses({});
    setBioLoginState(false);
    setBioTxState(false);
    loggingOutRef.current = false;
  };

  /**
   * A session the server or the wallet has ended: sign out and open sign-in,
   * which says why. Before this, a dead session stayed signed in - balances
   * still showed, the PIN still unlocked, and every transfer failed until the
   * person signed out and back in themselves.
   *
   * Ignored while signed out, and while a sign-out the person asked for is
   * already running: its own last requests can be refused on the way out, and
   * that is no reason to tell them they were signed out.
   */
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(
    () =>
      onSessionEnded(() => {
        if (!isLoggedInRef.current || loggingOutRef.current) {
          takeSessionEndReason();
          return;
        }
        void logoutRef.current();
        try {
          router.replace("/auth/dynamic-onboarding" as any);
        } catch {
          // Not mounted yet - signed out all the same, and the root opens sign-in.
        }
      }),
    [],
  );

  const setPin = async (newPin: string) => {
    await setUserPin(newPin);
    setIsPinSet(true);
    setUser((prev) => prev ? { ...prev, pinSet: true } : prev);
  };

  const verifyPin = async (inputPin: string): Promise<boolean> => {
    try {
      await verifyUserPin(inputPin);
      return true;
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;

      // Wrong PIN — backend returns 401 with attemptsRemaining
      if (status === 401 && data?.attemptsRemaining !== undefined) {
        const err: any = new Error("WRONG_PIN");
        err.attemptsRemaining = data.attemptsRemaining;
        throw err;
      }

      /**
       * Any 429, not only the PIN_LOCKED one.
       *
       * Two different things return 429 here: the per-user PIN lockout, which
       * sets code PIN_LOCKED, and the route rate limiter, which sets no code
       * at all. Matching only the first meant a rate-limited request fell
       * through to `return false` and was reported as an incorrect PIN - so a
       * correct PIN looked wrong, and the real reason never reached the user.
       */
      if (status === 429) {
        const err: any = new Error("PIN_LOCKED");
        err.lockedUntil = data?.lockedUntil;
        err.errorMessage = data?.error;
        throw err;
      }

      // Genuine session expiry (401/403 without PIN-specific fields)
      if (status === 401 || status === 403) {
        throw new Error("SESSION_EXPIRED");
      }

      /**
       * No PIN on the account at all.
       *
       * The server answers 400 "PIN not set", which used to fall through to
       * `return false` and be reported as an incorrect PIN - so an account
       * with no PIN told the user their correct PIN was wrong, forever.
       */
      if (status === 400 && /pin not set/i.test(String(data?.error || ""))) {
        throw new Error("PIN_NOT_SET");
      }

      // Anything else: carry the server's own words rather than inventing
      // "incorrect PIN", which is what hid the two cases above.
      if (data?.error) {
        const err: any = new Error("PIN_ERROR");
        err.errorMessage = data.error;
        throw err;
      }
      return false;
    }
  };

  const register = async (data: Partial<User> & { password: string; referralCode?: string }) => {
    const result = await registerUser({
      email: data.email || "",
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      referralCode: data.referralCode,
    });
    setUser(mapAuthUser(result.user));
    setIsLoggedIn(true);
    // Set active user so wallet-core stores the key under this user
    await setActiveUserId(result.user.id);

    // Wallet is NOT auto-created anymore. After email verification the home
    // screen shows the wallet-type chooser (email vs 12-word) and
    // finishWalletSetup() creates the chosen kind.
  };

  const verifyEmailHandler = async (code: string) => {
    if (!user?.email) throw new Error("No user email");
    await verifyEmailApi(user.email, code);
    // Server also activates the session (loginVerifiedAt) on success.
    const verified = { ...user, emailVerified: true, loginVerified: true };
    setUser(verified);
    // Keep the cached user in sync — otherwise a later reload where getMe()
    // transiently fails would restore the stale (loginVerified:false) cache and
    // wrongly bounce the user to the verify-email screen.
    AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(verified)).catch(() => {});
    // Now that the session is loginVerified, run the wallet bootstrap. This
    // is what populates hasWallet so the WalletRecoveryModal appears on home
    // for new-device logins (previously this ran during login() and silently
    // 401'd, leaving hasWallet=false until a refresh).
    setupWalletAfterAuth().then(() => loadAllData()).catch(() => loadAllData());
  };

  const resendVerificationHandler = async () => {
    if (!user?.email) throw new Error("No user email");
    await resendVerificationApi(user.email);
  };

  const addSavings = async (plan: { asset: string; chain: string; amount: number; durationDays: number; name?: string }): Promise<{ amount: number; fee: number; txHash: string }> => {
    // Phase 1: Build on-chain tx
    const { prepareId, signingMessage } = await prepareSavingsLock(plan);
    // Phase 2: Sign with user's Movement key
    const { signature, publicKey } = await signMovementTransaction(signingMessage);
    // Phase 3: Submit signed tx
    const { lock } = await submitSavingsLock({ prepareId, signature, publicKey });
    await Promise.all([refreshBalances(true), refreshSavings()]);
    return { amount: Number(lock.amount), fee: Number(lock.fee || 0), txHash: lock.txHash || "" };
  };

  const withdrawSavings = async (id: string) => {
    // Phase 1: Build on-chain withdraw tx
    const { prepareId, signingMessage } = await prepareSavingsWithdraw(id);
    // Phase 2: Sign with user's Movement key
    const { signature, publicKey } = await signMovementTransaction(signingMessage);
    // Phase 3: Submit signed tx
    await submitSavingsWithdraw(id, { prepareId, signature, publicKey });
    await Promise.all([refreshBalances(true), refreshSavings()]);
  };

  const addToLock = async (id: string, amount: number): Promise<{ amount: number; fee: number; txHash: string }> => {
    // Phase 1: Build on-chain add_to_lock tx
    const { prepareId, signingMessage } = await prepareSavingsAddToLock(id, { amount });
    // Phase 2: Sign with user's Movement key
    const { signature, publicKey } = await signMovementTransaction(signingMessage);
    // Phase 3: Submit signed tx
    const { lock } = await submitSavingsAddToLock(id, { prepareId, signature, publicKey });
    await Promise.all([refreshBalances(true), refreshSavings()]);
    return { amount: Number(lock.amount), fee: Number(lock.fee || 0), txHash: lock.txHash || "" };
  };

  const refreshUser = useCallback(async () => {
    try {
      const { user: authUser } = await getMe();
      const mapped = mapAuthUser(authUser);
      setUser(mapped);
      setIsPinSet(authUser.pinSet);
      // Keep the offline-restore cache current with the latest verified state.
      AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(mapped)).catch(() => {});
    } catch {}
  }, []);

  const updateUser = async (fields: Partial<User>) => {
    const apiFields: Record<string, string> = {};
    if (fields.firstName !== undefined) apiFields.firstName = fields.firstName;
    if (fields.lastName !== undefined) apiFields.lastName = fields.lastName;
    if (fields.username !== undefined) apiFields.username = fields.username;
    if (fields.phone !== undefined) apiFields.phone = fields.phone;
    if (Object.keys(apiFields).length > 0) await updateProfile(apiFields);
    setUser((prev) => prev ? { ...prev, ...fields } : prev);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        isLoggedIn,
        isReady,
        isPinSet,
        usdcBalance,
        usdtBalance,
        usdcxBalance,
        cngnBalance,
        ethBalance,
        moveBalance,
        solBalance,
        ngnBalance,
        transactions,
        savings,
        login,
        authenticateDynamic,
        logout,
        setPin,
        verifyPin,
        register,
        connectWallet,
        walletType: user?.walletType ?? null,
        finishWalletSetup,
        walletReady,
        hasWallet,
        walletError,
        retryWalletSetup,
        walletAddresses,
        walletBalances,
        verifyEmail: verifyEmailHandler,
        resendVerification: resendVerificationHandler,
        addSavings,
        withdrawSavings,
        addToLock,
        refreshBalances,
        refreshTransactions,
        refreshSavings,
        refreshUser,
        updateUser,
        bioLogin,
        setBioLogin: async (v: boolean) => {
          try { await toggleBiometric(v); } catch {}
          setBioLoginState(v);
          await AsyncStorage.setItem("@bioLogin", v ? "true" : "false");
        },
        balancesLoading,
        unlocked,
        setUnlocked,
        sessionId,
        rates,
        refreshRates,
        bioTx,
        setBioTx: async (v: boolean) => {
          setBioTxState(v);
          await AsyncStorage.setItem("@bioTx", v ? "true" : "false");
        },
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
