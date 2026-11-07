import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Clipboard,
  Animated,
  Share,
  Modal,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useServiceStatus } from "@/hooks/useServiceStatus";
import type { ServiceKey } from "@/constants/services";
import { TokenLogo } from "@/components/TokenLogo";
import { useApp } from "@/context/AppContext";
import { TOKEN_NETWORKS, TokenSymbol, NetworkInfo } from "@/constants/transfer";
import { getLocalAddresses } from "@/services/wallet-core";
import { getStellarStatus, activateStellar } from "@/services/stellar";
import { getRoutedDeposits, type RoutedAsset } from "@/services/routed-deposits";
import QRCode from "react-native-qrcode-svg";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";

const NETWORK_NAMES: Record<string, string> = {
  MOVE: "Movement",
  BASE: "Base",
  SOL: "Solana",
  BEP20: "BNB Smart Chain",
  ARC: "Arc",
  TON: "TON",
  ARB: "Arbitrum",
  STELLAR: "Stellar",
  MONAD: "Monad",
  TRON: "Tron",
  ETH_IN: "Ethereum",
  ARB_IN: "Arbitrum",
};

// The console's switch for each network this wallet receives on.
const DEPOSIT_SWITCH: Record<string, ServiceKey> = {
  MOVE: "depositMove",
  SOL: "depositSol",
  BASE: "depositEvm",
  BEP20: "depositEvm",
  ARC: "depositEvm",
  ARB: "depositEvm",
  MONAD: "depositEvm",
  TON: "depositTon",
  STELLAR: "depositStellar",
};

// Chain marks for the picker. A name alone makes the list read as settings;
// the logos are how people recognise a chain at a glance.
const NETWORK_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  ARB: require("@/assets/images/arbitrumlogo.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
  TRON: require("@/assets/images/trx.png"),
  ETH_IN: require("@/assets/images/eth.png"),
  ARB_IN: require("@/assets/images/arbitrumlogo.png"),
};

/**
 * Networks that convert on the way in, offered in the dropdown on this screen
 * only: Tron for USDT, Ethereum and Arbitrum for both.
 *
 * None is one of the person's wallets. A coin sent there goes to a deposit
 * address of their own that converts it, and arrives as USDC in their wallet.
 * So they are added here, not to TOKEN_NETWORKS, which also drives sends and
 * withdrawals.
 */
type ConvertedNet = NetworkInfo & { chainId: number; standard: string };
const CONVERTED_NETS: Record<string, ConvertedNet[]> = {
  USDT: [
    { name: "Tron", tag: "TRON", chainId: 728126428, standard: "TRC20" },
    { name: "Ethereum", tag: "ETH_IN", chainId: 1, standard: "ERC20" },
    { name: "Arbitrum", tag: "ARB_IN", chainId: 42161, standard: "Arbitrum One" },
  ],
  USDC: [
    { name: "Ethereum", tag: "ETH_IN", chainId: 1, standard: "ERC20" },
    { name: "Arbitrum", tag: "ARB_IN", chainId: 42161, standard: "Arbitrum One" },
  ],
};

export default function DepositScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletReady, walletAddresses } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const params = useLocalSearchParams<{ crypto: string; network: string }>();

  // ─── Local address derivation (tamper-proof) ─────────────
  const [localAddresses, setLocalAddresses] = useState<Record<string, string> | null>(null);
  const [addressTampered, setAddressTampered] = useState(false);

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to receive deposits.", [{ text: "OK", onPress: () => router.back() }]);
      return;
    }
    // Derive addresses from on-device mnemonic — never trust the backend
    getLocalAddresses().then((addrs) => {
      if (addrs) setLocalAddresses(addrs);
    });
  }, [walletReady]);

  const token = (params.crypto as TokenSymbol) || "USDC";
  /**
   * The converting addresses, read once when the screen opens: they decide
   * which converting networks the dropdown lists (only what the server
   * offers - one switched off in the console is simply not there) and which
   * address each shows.
   */
  const [routed, setRouted] = useState<RoutedAsset[] | null>(CONVERTED_NETS[token] ? null : []);
  useEffect(() => {
    if (!CONVERTED_NETS[token]) return;
    let alive = true;
    getRoutedDeposits()
      .then((d) => alive && setRouted(d.assets ?? []))
      .catch(() => alive && setRouted([]));
    return () => {
      alive = false;
    };
  }, [token]);
  const offered = (n: ConvertedNet) => !!routed?.some((a) => a.chainId === n.chainId && a.symbol === token);

  // Networks switched off in the console aren't offered. Not knowing yet means on.
  const { paused } = useServiceStatus();
  const allNetworks: NetworkInfo[] = [
    ...(TOKEN_NETWORKS[token] || TOKEN_NETWORKS.USDC),
    ...(CONVERTED_NETS[token] ?? []).filter(offered),
  ];
  const networks = allNetworks.filter((n) => !(DEPOSIT_SWITCH[n.tag] && paused(DEPOSIT_SWITCH[n.tag])));
  const initialTag = params.network || (networks[0] ?? allNetworks[0]).tag;
  const initialNet = networks.find((n) => n.tag === initialTag) || networks[0] || allNetworks[0];

  const [selectedNetwork, setSelectedNetwork] = useState<NetworkInfo>(initialNet);
  useEffect(() => {
    if (networks.length && !networks.some((n) => n.tag === selectedNetwork.tag)) setSelectedNetwork(networks[0]);
  }, [networks.map((n) => n.tag).join(), selectedNetwork.tag]);
  const [showNetworkSheet, setShowNetworkSheet] = useState(false);
  // The off-screen card that gets photographed when Share is pressed.
  const shareCardRef = useRef<View>(null);

  const networkName = NETWORK_NAMES[selectedNetwork.tag] || selectedNetwork.name;

  // Always prefer the locally-derived address; fall back to backend only if local isn't ready yet
  const localAddr = localAddresses?.[selectedNetwork.tag] || "";
  const backendAddr = walletAddresses[selectedNetwork.tag] || "";

  // A converting network picked: its address from the list read above.
  const conv = (CONVERTED_NETS[token] ?? []).find((n) => n.tag === selectedNetwork.tag) ?? null;
  const isConverted = !!conv;
  const convAsset = conv ? routed?.find((a) => a.chainId === conv.chainId && a.symbol === token) : undefined;
  const convAddr: { state: "loading" | "ready" | "unavailable"; address: string; minimum: string | null } =
    routed === null
      ? { state: "loading", address: "", minimum: null }
      : convAsset && convAsset.state !== "unavailable" && convAsset.address
        ? { state: "ready", address: convAsset.address, minimum: convAsset.minimum }
        : { state: "unavailable", address: "", minimum: null };
  const convBlocked = isConverted && convAddr.state !== "ready";

  const walletAddress = isConverted ? convAddr.address : localAddr || backendAddr;

  // Detect tampering: backend address differs from locally-derived address
  useEffect(() => {
    if (localAddr && backendAddr && localAddr.toLowerCase() !== backendAddr.toLowerCase()) {
      setAddressTampered(true);
    } else {
      setAddressTampered(false);
    }
  }, [localAddr, backendAddr]);

  /**
   * Stellar has to be opened before anything can arrive.
   *
   * The address exists the moment the user has a Solana key, but a payment
   * to an account that has not been opened - or has no trustline for the
   * coin - is refused by the network. So picking Stellar checks first, and
   * until the coin is open the screen offers to open it instead of showing an
   * address that cannot yet receive. Opening costs the user nothing: our
   * treasury pays the fee and the reserve.
   */
  const isStellar = selectedNetwork.tag === "STELLAR";
  const stellarCoin = token === "USDT" ? "USDT" : "USDC";
  const stellarCoinName = token === "USDT" ? "USDT" : "USDC";
  const [stellarState, setStellarState] = useState<
    "checking" | "needs" | "ready" | "unavailable" | "error"
  >("checking");
  const [activating, setActivating] = useState(false);
  // Bumped by Try again: the check depends on nothing else that changes.
  const [stellarCheck, setStellarCheck] = useState(0);

  useEffect(() => {
    if (!isStellar) return;
    let alive = true;
    setStellarState("checking");
    getStellarStatus()
      .then((st) => {
        if (!alive) return;
        if (!st.available) setStellarState("unavailable");
        else setStellarState(st.trust?.[stellarCoin] ? "ready" : "needs");
      })
      .catch(() => alive && setStellarState("error"));
    return () => {
      alive = false;
    };
  }, [isStellar, stellarCoin, stellarCheck]);

  const stellarBlocked = isStellar && stellarState !== "ready";

  const handleActivateStellar = async () => {
    if (activating) return;
    setActivating(true);
    try {
      await activateStellar(stellarCoin);
      setStellarState("ready");
    } catch (e: any) {
      Alert.alert(
        "Could not set up Stellar",
        e?.response?.data?.error || e?.message || "Please try again.",
      );
    } finally {
      setActivating(false);
    }
  };

  const [showToast, setShowToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastDrop = useRef(new Animated.Value(-10)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    try { Clipboard.setString(walletAddress); } catch {}
    setShowToast(true);
    Animated.parallel([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(toastDrop, { toValue: 0, damping: 15, stiffness: 220, mass: 0.7, useNativeDriver: true }),
    ]).start();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(toastDrop, { toValue: -10, duration: 260, useNativeDriver: true }),
      ]).start(() => setShowToast(false));
    }, 2000);
  };

  /**
   * Share a card, not a string of hex.
   *
   * A bare address is unreadable and unverifiable: whoever receives it cannot
   * tell a good one from a typo, and nothing on it says which chain it belongs
   * to - which is how deposits get burned. So what leaves the app is a picture
   * of the code with the token, the chain and the warning printed around it,
   * under the Money Moves mark, so the recipient can see what they were sent
   * and who sent it.
   */
  const shareMessage = () =>
    `Send me ${token} on ${networkName}. My Money Moves ${isConverted ? "deposit" : "wallet"} address:\n` +
    `${walletAddress}\n\n` +
    `${token} on ${networkName} only. Any other token or chain cannot be recovered.`;

  const handleShare = async () => {
    // The card carries everything, so text is the fallback rather than the
    // payload - for when capture fails or the platform cannot share files.
    const shareText = () => Share.share({ message: shareMessage() }).catch(() => {});

    if (!walletAddress) return;

    try {
      /**
       * Capture the card's own view, and give up if it takes too long.
       *
       * The <ViewShot> wrapper was the bug: its capture() waits on an internal
       * promise that only resolves from the wrapper's onLayout, and off-screen
       * under Fabric that never arrived - so the button sat there doing
       * nothing, with no error to fall back from. captureRef() goes straight to
       * the view, and the race means the worst case is a text share rather than
       * a dead button.
       */
      const uri = await Promise.race([
        captureRef(shareCardRef, {
          format: "png",
          quality: 1,
          // iOS otherwise snapshots the screen, which this card is not on, and
          // hands back a blank image. Rendering the layer draws it wherever it
          // happens to be parked.
          useRenderInContext: true,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);

      if (!uri || !(await Sharing.isAvailableAsync())) return shareText();

      // iOS carries a caption alongside the image; Android's share sheet takes
      // the file alone, which is why the card has to stand on its own.
      if (Platform.OS === "ios") {
        await Share.share({ message: shareMessage(), url: uri });
      } else {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: `My Money Moves ${token} address`,
        });
      }
    } catch (err) {
      console.warn("[DEPOSIT] share card failed, sending text instead:", err);
      shareText();
    }
  };

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  if (!networks.length) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 }}>
        <Text style={{ color: colors.foreground, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" }}>{token} deposits are paused</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" }}>
          Please check back shortly.
        </Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: colors.primary, fontSize: 15, fontFamily: "Inter_600SemiBold" }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* ─── Tamper block screen ─── */}
      {addressTampered && (
        <View style={[s.tamperBlock, { paddingTop: topPad }]}>
          <View style={s.tamperContent}>
            <View style={s.tamperIcon}>
              <Feather name="shield-off" size={48} color="#fff" />
            </View>
            <Text style={s.tamperTitle}>Security Alert</Text>
            <Text style={s.tamperDesc}>
              Your wallet address on the server does not match your device. Deposits have been disabled for your safety.
            </Text>
            <Text style={s.tamperDesc}>
              Please contact support immediately.
            </Text>
            <TouchableOpacity
              style={s.tamperBtn}
              onPress={() => router.push("/account/support")}
            >
              <Feather name="message-circle" size={20} color="#fff" />
              <Text style={s.tamperBtnText}>Contact Support</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.tamperBackBtn}
              onPress={() => router.back()}
            >
              <Text style={[s.tamperBackText, { color: colors.mutedForeground }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* The shared card, rendered off to the side of the screen so it can be
          photographed on demand. It is laid out and drawn like anything else -
          it is simply never scrolled to. collapsable={false} keeps Android from
          flattening it away before there is anything to capture. */}
      <View style={sh.host} pointerEvents="none">
        <View ref={shareCardRef} style={sh.card} collapsable={false}>
          <Image
            source={require("@/assets/images/logo-lockup.png")}
            style={sh.lockup}
            resizeMode="contain"
          />

          <Text style={sh.heading}>Send me {token}</Text>
          <Text style={sh.sub}>Scan the code, or copy the address below</Text>

          <View style={sh.qrPanel}>
            <QRCode
              value={walletAddress || " "}
              size={214}
              backgroundColor="#fff"
              color="#000"
              logo={require("@/assets/images/logo-qr.png")}
              logoSize={38}
              logoBackgroundColor="#fff"
              logoBorderRadius={19}
              logoMargin={4}
            />
          </View>

          {/* The chain, spelled out. The most expensive mistake a sender can
              make is the right token on the wrong network. */}
          <View style={sh.chain}>
            <Image source={NETWORK_LOGOS[selectedNetwork.tag]} style={sh.chainLogo} resizeMode="cover" />
            <Text style={sh.chainText}>{networkName} network</Text>
          </View>

          <Text style={sh.addrLabel}>WALLET ADDRESS</Text>
          <Text style={sh.addr}>{walletAddress}</Text>

          <View style={sh.warn}>
            <Text style={sh.warnText}>
              Send {token} on {networkName} only. Any other token or chain cannot be recovered.
            </Text>
          </View>

          <Text style={sh.foot}>usemoneymoves.xyz</Text>
        </View>
      </View>

      {/* Header: the token is in the title, so the row needs no logo of its
          own - two marks for one thing reads as decoration. */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Deposit {token}</Text>
      </View>

      {/* Floats over the header rather than sitting in the layout. Inline it
          pushed the whole page down on copy and back up on dismiss, which read
          as the screen flinching every time you tapped. */}
      {showToast && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.toast,
            {
              top: topPad + 8,
              backgroundColor: colors.primary,
              opacity: toastOpacity,
              transform: [{ translateY: toastDrop }],
            },
          ]}
        >
          <Feather name="copy" size={15} color={colors.primaryForeground} />
          <Text style={[s.toastText, { color: colors.primaryForeground }]}>
            Wallet address copied
          </Text>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Stellar, not yet open for this coin: offer to open it rather than
            show an address the network would refuse payments to. */}
        {convBlocked ? (
          <View style={[s.stellarCard, { backgroundColor: colors.card }]}>
            <Image source={NETWORK_LOGOS[selectedNetwork.tag]} style={s.stellarLogo} resizeMode="cover" />
            {convAddr.state === "loading" ? (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={[s.stellarText, { color: colors.mutedForeground }]}>Getting your {networkName} address…</Text>
              </>
            ) : (
              <>
                <Text style={[s.stellarTitle, { color: colors.foreground }]}>{networkName} is not available right now</Text>
                <Text style={[s.stellarText, { color: colors.mutedForeground }]}>
                  Pick another network to deposit {token} for now.
                </Text>
              </>
            )}
          </View>
        ) : stellarBlocked ? (
          <View style={[s.stellarCard, { backgroundColor: colors.card }]}>
            <Image source={NETWORK_LOGOS.STELLAR} style={s.stellarLogo} resizeMode="cover" />
            {stellarState === "checking" ? (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={[s.stellarText, { color: colors.mutedForeground }]}>Checking your Stellar wallet…</Text>
              </>
            ) : stellarState === "unavailable" ? (
              <>
                <Text style={[s.stellarTitle, { color: colors.foreground }]}>Stellar is not available yet</Text>
                <Text style={[s.stellarText, { color: colors.mutedForeground }]}>
                  Pick another network to deposit {token} for now.
                </Text>
              </>
            ) : stellarState === "error" ? (
              <>
                <Text style={[s.stellarTitle, { color: colors.foreground }]}>Could not reach Stellar</Text>
                <TouchableOpacity
                  style={[s.stellarBtn, { backgroundColor: colors.muted }]}
                  onPress={() => setStellarCheck((n) => n + 1)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.stellarBtnText, { color: colors.foreground }]}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[s.stellarTitle, { color: colors.foreground }]}>
                  Set up Stellar {stellarCoinName}
                </Text>
                <Text style={[s.stellarText, { color: colors.mutedForeground }]}>
                  Stellar needs a one-time setup before {stellarCoinName} can arrive. It's free: we cover the
                  network cost.
                </Text>
                <TouchableOpacity
                  style={[s.stellarBtn, { backgroundColor: colors.primary, opacity: activating ? 0.7 : 1 }]}
                  onPress={handleActivateStellar}
                  disabled={activating}
                  activeOpacity={0.85}
                >
                  {activating ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[s.stellarBtnText, { color: colors.primaryForeground }]}>
                      Set up Stellar {stellarCoinName}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
        /* The code sits on its own white card whatever the theme. A QR has to
            be dark-on-light to scan, so this one surface stays fixed. */
        <View style={s.qrCard}>
          {walletAddress ? (
            <QRCode
              value={walletAddress}
              size={232}
              backgroundColor="#fff"
              color="#000"
              /* A QR-only variant of the badge: same disc, smaller mark. */
              logo={require("@/assets/images/logo-qr.png")}
              logoSize={36}
              logoBackgroundColor="#fff"
              logoBorderRadius={18}
              logoMargin={4}
            />
          ) : (
            <View style={s.qrEmpty}>
              <Feather name="alert-circle" size={30} color="#bbb" />
              <Text style={s.qrEmptyText}>No address</Text>
            </View>
          )}
        </View>
        )}

        {/* Network, as a field rather than a heading and a control. It is one
            row that states a value and opens the list that changes it. */}
        <TouchableOpacity
          style={[s.field, { backgroundColor: colors.card }]}
          activeOpacity={0.75}
          onPress={() => setShowNetworkSheet(true)}
        >
          <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Network</Text>
          <View style={s.fieldValue}>
            <Image source={NETWORK_LOGOS[selectedNetwork.tag]} style={s.fieldLogo} resizeMode="cover" />
            {/* The chain's name, not its ticker. "MOVE" is the token; the
                chain it settles on is Movement, and showing the ticker in a
                field labelled Network said the wrong one of the two. */}
            <Text style={[s.fieldValueText, { color: colors.foreground }]}>
              {networkName}
            </Text>
            <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
          </View>
        </TouchableOpacity>

        {!stellarBlocked && !convBlocked && (
        <View style={[s.addressCard, { backgroundColor: colors.card }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.addressLabel, { color: colors.mutedForeground }]}>{isConverted ? "Deposit address" : "Wallet address"}</Text>
            <Text style={[s.addressText, { color: colors.foreground }]} selectable>
              {walletAddress}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleCopy}
            style={[s.copyChip, { borderColor: colors.border }]}
            hitSlop={8}
          >
            <Feather name="copy" size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        )}

        {/* Deposit info, as prose rather than badges. The two things that can
            lose money - wrong token, wrong chain - are stated first. */}
        <View style={[s.infoCard, { backgroundColor: colors.card }]}>
          <Text style={[s.infoTitle, { color: colors.foreground }]}>Deposit info</Text>
          {(isConverted
            ? [
                `Send ${token} only, on ${networkName} (${conv!.standard})`,
                ...(convAddr.minimum ? [`At least ${convAddr.minimum} ${token}`] : []),
                "Arrives as USDC in your wallet, converted on the way in",
                "Another token or chain cannot be recovered",
              ]
            : isStellar
            ? [
                // On Stellar USDT is issued as USDT0; a sender's wallet may
                // list it under either name.
                token === "USDT"
                  ? "Send USDT (shown as USDT0 on Stellar) only, on Stellar"
                  : "Send USDC only, on Stellar",
                "No memo needed",
                "Another token or chain cannot be recovered",
                "Arrives in seconds",
              ]
            : [
                selectedNetwork.tag === "MONAD" && token === "USDT"
                  ? "Send USDT (shown as USDT0 on Monad) only, on Monad"
                  : `Send ${token} only, on ${networkName}`,
                "Another token or chain cannot be recovered",
                "Arrives once the network confirms it",
              ]
          ).map((line) => (
            <View key={line} style={s.infoRow}>
              <View style={[s.bullet, { backgroundColor: colors.mutedForeground }]} />
              <Text style={[s.infoText, { color: colors.mutedForeground }]}>{line}</Text>
            </View>
          ))}
        </View>
        {/* In the flow, under the info, rather than pinned to the bottom.
            The screen is short enough to hold everything, and a fixed bar left
            a gap under the content that made the page look unfinished. */}
        {!stellarBlocked && !convBlocked && (
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.muted }]}
            onPress={handleCopy}
            activeOpacity={0.8}
          >
            <Feather name="copy" size={17} color={colors.foreground} />
            <Text style={[s.actionText, { color: colors.foreground }]}>Copy address</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.primary }]}
            onPress={handleShare}
            activeOpacity={0.85}
          >
            <Feather name="share" size={17} color={colors.primaryForeground} />
            <Text style={[s.actionText, { color: colors.primaryForeground }]}>Share</Text>
          </TouchableOpacity>
        </View>
        )}
      </ScrollView>

      {/* Network Selection Bottom Sheet */}
      {showNetworkSheet && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={s.overlay}
            activeOpacity={1}
            onPress={() => setShowNetworkSheet(false)}
          >
            <View
              style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[s.sheetHandle, { backgroundColor: colors.border }]} />

              <View style={[s.sheetWarning, { backgroundColor: colors.primary + "12" }]}>
                <Ionicons name="alert-circle" size={19} color={colors.primary} />
                <Text style={[s.sheetWarningText, { color: colors.primary }]}>
                  The chain you send from must match the one you pick here.
                  Funds sent on another chain cannot be recovered.
                </Text>
              </View>

              <Text style={[s.sheetLabel, { color: colors.foreground }]}>Send {token}</Text>

              <View style={{ gap: 2 }}>
                {networks.map((net) => {
                  const active = selectedNetwork.tag === net.tag;
                  return (
                    <TouchableOpacity
                      key={net.tag}
                      style={[
                        s.sheetNetworkRow,
                        // Selected is filled rather than outlined - a tick plus a
                        // coloured edge says the same thing twice, and the fill
                        // is what carries at a glance.
                        active && { backgroundColor: colors.muted },
                      ]}
                      activeOpacity={0.75}
                      onPress={() => {
                        setSelectedNetwork(net);
                        setShowNetworkSheet(false);
                      }}
                    >
                      <Image source={NETWORK_LOGOS[net.tag]} style={s.sheetNetLogo} resizeMode="cover" />
                      {/* flex so the name starts at the logo. Without it the
                          row's space-between threw the name to the far edge on
                          every row that had no tick to balance it. */}
                      <Text style={[s.sheetNetworkText, { color: colors.foreground }]}>
                        {NETWORK_NAMES[net.tag] || net.name}
                      </Text>
                      {/* Ionicons rather than Feather: Feather's check-circle
                          breaks the ring where the tick crosses it, which at
                          this size reads as a broken circle. This one is a
                          closed ring with the tick inside. */}
                      {active && (
                        <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

/**
 * The share card.
 *
 * Kept apart from the screen's styles because it is not part of the screen: it
 * never follows the theme. It goes out to people who may never have seen the
 * app, so it is always the brand's dark and lime - a card that looks the same
 * whoever sent it.
 */
const BRAND_BG = "#0E0E0F";
const BRAND_PANEL = "#1A1A1C";
const BRAND_LIME = "#81FB02";

const sh = StyleSheet.create({
  // Parked off to the left. Far enough that no part of it can show on a wide
  // display, near enough that it is still a laid-out, drawable view.
  host: { position: "absolute", left: -1200, top: 0 },
  card: {
    width: 340,
    backgroundColor: BRAND_BG,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 20,
    alignItems: "center",
  },

  // The mark and the words are one piece of artwork, so they are one image -
  // pairing a separate badge with a separate wordmark only invents a gap and a
  // baseline to get wrong. Cropped to its ink at 1150x164, so the height here
  // follows the width rather than being guessed.
  lockup: { width: 168, height: 24, marginBottom: 22 },

  heading: {
    color: "#fff",
    fontSize: 25,
    lineHeight: 31,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.7,
  },
  sub: {
    color: "#8A8A8F",
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
    marginBottom: 20,
  },

  // White, and only as big as the code needs: a quiet zone is part of a QR, and
  // this padding is it.
  qrPanel: { backgroundColor: "#fff", padding: 16, borderRadius: 20 },

  chain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: BRAND_PANEL,
    paddingLeft: 7,
    paddingRight: 13,
    paddingVertical: 7,
    borderRadius: 999,
    marginTop: 18,
  },
  chainLogo: { width: 20, height: 20, borderRadius: 10 },
  chainText: { color: "#fff", fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  addrLabel: {
    color: "#6E6E73",
    fontSize: 9.5,
    lineHeight: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 7,
  },
  // Monospace, centred and wrapped - an address is checked character by
  // character, and a proportional font makes that harder than it needs to be.
  addr: {
    color: "#fff",
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // The one line on the card that can save money, so it gets the brand colour
  // and a rule of its own rather than sitting in with the small print.
  warn: {
    // Edge to edge, so the rule reads as a divider across the card rather than
    // an underline sized to whatever the sentence happens to be.
    alignSelf: "stretch",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#262628",
    marginTop: 18,
    paddingTop: 14,
  },
  warnText: {
    color: BRAND_LIME,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: "center",
    fontFamily: "Inter_500Medium",
  },

  foot: {
    color: "#5A5A5F",
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
    marginTop: 14,
  },
});

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginBottom: 8 },
  headerBack: { position: "absolute", left: 18 },
  headerTitle: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },

  content: { paddingHorizontal: 18 },

  /**
   * The code is the screen.
   *
   * Everything else here is a caption on it, so it gets the width - a QR that
   * has to be squinted at or brought closer to a camera is the one thing this
   * page must not get wrong.
   */
  qrCard: {
    alignSelf: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 22,
    marginTop: 4,
    marginBottom: 24,
  },
  qrEmpty: { width: 232, height: 232, alignItems: "center", justifyContent: "center", gap: 8 },
  qrEmptyText: { color: "#999", fontSize: 13, fontFamily: "Inter_400Regular" },

  // Takes the QR card's place while Stellar is not yet open for the coin.
  stellarCard: {
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 22,
    marginTop: 4,
    marginBottom: 24,
    alignItems: "center",
    gap: 12,
    minHeight: 264,
    justifyContent: "center",
  },
  stellarLogo: { width: 52, height: 52, borderRadius: 26, marginBottom: 4 },
  stellarTitle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  stellarText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  stellarBtn: {
    marginTop: 8,
    height: 50,
    borderRadius: 14,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  stellarBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 18,
    marginBottom: 14,
  },
  fieldLabel: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_400Regular" },
  fieldValue: { flexDirection: "row", alignItems: "center", gap: 9 },
  fieldLogo: { width: 24, height: 24, borderRadius: 12 },
  fieldValueText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  addressCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 17,
    borderRadius: 18,
    marginBottom: 14,
  },
  addressLabel: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginBottom: 6 },
  // Monospace so the characters stay countable when checking an address.
  addressText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyChip: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  infoCard: { padding: 18, borderRadius: 18, gap: 11 },
  infoTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginBottom: 3 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },

  actions: { flexDirection: "row", gap: 11, marginTop: 22 },
  // Pills. Fully rounded reads as an action you take, where a soft rectangle
  // reads as another panel - and every other block on this screen is a panel.
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 999,
  },
  actionText: { fontSize: 15.5, lineHeight: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  container: { flex: 1 },

  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    zIndex: 99,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  toastText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },



  /* QR */

  /* Fields */



  /* Warning banner */

  /* Info tags */

  /* Bottom bar */

  /* Bottom sheet */
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    // Narrower than the screen's own margin: the rows carry their own padding,
    // so the selected row's fill lines up with the cards behind the sheet.
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d1d1",
    alignSelf: "center",
    marginBottom: 20,
  },
  sheetTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 16 },
  sheetWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  sheetWarningIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  sheetWarningText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  sheetLabel: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold", marginTop: 22, marginBottom: 10, paddingHorizontal: 2 },
  // No fill and no border by default - only the chosen row gets a surface, so
  // the list reads as one choice rather than eight buttons.
  sheetNetworkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 13,
    paddingVertical: 14,
    borderRadius: 14,
  },
  sheetNetLogo: { width: 29, height: 29, borderRadius: 15 },
  sheetNetworkText: { flex: 1, fontSize: 16, lineHeight: 21, fontFamily: "Inter_500Medium" },

  /* Tamper block overlay */
  tamperBlock: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#111",
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  tamperContent: { alignItems: "center", maxWidth: 340 },
  tamperIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#B91C1C",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  tamperTitle: {
    color: "#fff",
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 16,
    textAlign: "center",
  },
  tamperDesc: {
    color: "#D1D5DB",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 8,
  },
  tamperBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#B91C1C",
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 28,
  },
  tamperBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  tamperBackBtn: { marginTop: 20, paddingVertical: 10 },
  tamperBackText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
