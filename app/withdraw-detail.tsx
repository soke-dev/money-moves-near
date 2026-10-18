import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal, StyleSheet, Image,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import { ts, TOKEN_NETWORKS, assetLabel, onChainAsset, TokenSymbol, NetworkInfo, validateWalletAddress, spendableBalance, MIN_WITHDRAW, isSendable, addressFromScan } from "@/constants/transfer";
import { KeyboardDoneBar } from "@/components/KeyboardDoneBar";
import { Keypad } from "@/components/Keypad";
import {
  listCryptoContacts,
  saveCryptoContact,
  CryptoContact,
} from "@/services/crypto-contacts";
import { CHAIN_MARKS } from "@/constants/transfer";

export default function WithdrawDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{ token: string; label?: string; network: string; networkName: string }>();
  // Display token id from the select screen: "USDC" (native), "USDCe" (legacy
  // bridged USDC.e), "USDT", "MOVE", "SOL".
  const wTokenId = params.token || "USDC";
  const isLegacyUsdc = wTokenId === "USDCe";
  const wLabel = params.label || assetLabel(wTokenId);
  const wLogo = (isLegacyUsdc ? "USDC" : wTokenId) as TokenSymbol;
  const wNetworks: NetworkInfo[] = isLegacyUsdc
    ? [{ name: "Movement", tag: "MOVE" }]
    : TOKEN_NETWORKS[wTokenId as TokenSymbol];
  // On-chain asset key for the selected chain (native Movement USDC = USDCx).
  const resolveAsset = (chain: string) => isLegacyUsdc ? "USDC" : onChainAsset(wTokenId, chain);
  const wNetworkTag = params.network || "";
  const wNetworkName = params.networkName || "";

  /**
   * The recipient, once it is settled.
   *
   * One screen, two faces: while this is empty it asks who to send to, and the
   * moment an address is confirmed it collapses to a chip and the amount
   * appears underneath. Splitting it across two routes made "change the
   * address" a back-navigation rather than a tap.
   */
  const [recipient, setRecipient] = useState("");
  const [wAddress, setWAddress] = useState("");
  const [tab, setTab] = useState<"recent" | "favourites">("recent");
  const [contacts, setContacts] = useState<CryptoContact[]>([]);
  const [saveContact, setSaveContact] = useState(false);
  const [wAmount, setWAmount] = useState("");
  // Stellar only: what an exchange asks for to credit the right account.
  const [wMemo, setWMemo] = useState("");
  const [showNetworkSheet, setShowNetworkSheet] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState<NetworkInfo>({ name: wNetworkName, tag: wNetworkTag });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await listCryptoContacts({ chain: currentNetwork.tag, limit: 30 }));
    } catch {
      // An empty list is the same as none saved, and this screen still works
      // with an address typed by hand.
    }
  }, [currentNetwork.tag]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const networkBalance = (chain: string) => {
    const entry = walletBalances.find(b => b.asset === resolveAsset(chain) && b.chain === chain);
    // Spendable, not held: on Arc the fee comes out of this same balance.
    return spendableBalance(chain, entry?.balance ?? 0);
  };

  const dec = wTokenId === "MOVE" ? 2 : 4;
  const balance = networkBalance(currentNetwork.tag);

  const minAmount = MIN_WITHDRAW[wTokenId] ?? 0.01;
  const insufficientWallet = Number(wAmount) > 0 && Number(wAmount) > balance;
  const belowMinimum = Number(wAmount) > 0 && Number(wAmount) < minAmount;
  const walletMaxAmount = balance;
  const addressValidation = wAddress.length > 0 && currentNetwork.tag
    ? validateWalletAddress(wAddress, currentNetwork.tag)
    : null;
  const invalidAddress = addressValidation !== null && !addressValidation.valid;

  /**
   * Keypad input, with the decimal rules the field used to get from the OS.
   *
   * A number-pad TextInput enforced none of this either - it just accepted
   * "0.00000001" and let the backend reject it later.
   */
  const handleAmountKey = (key: string) => {
    if (key === ".") {
      if (wAmount.includes(".")) return;
      setWAmount(wAmount ? wAmount + "." : "0.");
      return;
    }
    const next = wAmount + key;
    const frac = next.split(".")[1];
    // More decimals than the asset has are not a smaller amount, just a
    // longer string.
    if (frac && frac.length > dec) return;
    // A leading zero is only meaningful before a decimal point.
    setWAmount(/^0[0-9]/.test(next) ? next.slice(1) : next);
  };

  const handleScan = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    setShowScanner(true);
  };

  /** Short enough to read back, long enough to check against a QR. */
  const short = (addr: string) =>
    addr.length > 20 ? `${addr.slice(0, 6)}…${addr.slice(-8)}` : addr;

  const confirmAddress = (addr: string) => {
    const trimmed = addr.trim();
    if (!currentNetwork.tag) return;
    if (!validateWalletAddress(trimmed, currentNetwork.tag).valid) {
      setWAddress(trimmed);
      return;
    }
    setWAddress(trimmed);
    setRecipient(trimmed);
  };

  const handleProceed = () => {
    if (!currentNetwork.tag) return;
    const addrCheck = validateWalletAddress(wAddress, currentNetwork.tag);
    if (!addrCheck.valid) return;
    const num = Number(wAmount);
    if (!num || num <= 0) return;
    if (belowMinimum) return;
    if (insufficientWallet) return;
    // Saving is fire-and-forget: the address is already recorded server-side
    // when the withdrawal is created, so this only adds the favourite flag.
    if (saveContact) {
      saveCryptoContact({ address: recipient, chain: currentNetwork.tag, favourite: true })
        .catch(() => {});
    }

    router.push({
      pathname: "/withdraw-summary",
      params: {
        token: resolveAsset(currentNetwork.tag),
        label: wLabel,
        network: currentNetwork.tag,
        networkName: currentNetwork.name,
        address: recipient,
        amount: wAmount,
        ...(currentNetwork.tag === "STELLAR" && wMemo.trim() ? { memo: wMemo.trim() } : {}),
      },
    } as any);
  };

  /** The chains this token is actually held on. */
  const fundedNetworks = wNetworks.filter((net) =>
    // Big enough to send, not merely non-zero. Dust prints as 0.0000 and
    // goes nowhere.
    isSendable(net.tag, networkBalance(net.tag), minAmount),
  );

  const amountReady = Number(wAmount) > 0 && !belowMinimum && !insufficientWallet;

  const ngnValue =
    ((rates?.[resolveAsset(currentNetwork.tag) as keyof typeof rates] as any)?.ngn || 0) *
    Number(wAmount || 0);

  const shown = tab === "favourites" ? contacts.filter((c) => c.favourite) : contacts;

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Send Crypto</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {recipient ? (
          /* One stack, one gap. Without a wrapper the cards butted together
             here: in the other view the section labels were supplying the
             vertical rhythm, and this view has none. */
          <View style={d.stack}>
            {/* Settled. Tapping it hands the address back to the field. */}
            <TouchableOpacity
              style={[d.card, { backgroundColor: colors.card }]}
              onPress={() => { setRecipient(""); setWAmount(""); }}
              activeOpacity={0.8}
            >
              <View style={d.recipHead}>
                <Feather name="check" size={15} color={colors.primary} />
                <Text style={[d.recipLabel, { color: colors.primary }]}>Recipient</Text>
                <View style={{ flex: 1 }} />
                <Feather name="edit-2" size={13} color={colors.mutedForeground} />
              </View>
              <Text style={[d.recipAddr, { color: colors.foreground }]} numberOfLines={1}>
                {short(recipient)}
              </Text>
              <View style={d.recipNet}>
                <Text style={[d.recipNetLabel, { color: colors.mutedForeground }]}>Network:</Text>
                {CHAIN_MARKS[currentNetwork.tag] && (
                  <Image source={CHAIN_MARKS[currentNetwork.tag]} style={d.recipNetMark} />
                )}
                <Text style={[d.recipNetName, { color: colors.foreground }]}>{currentNetwork.name}</Text>
              </View>
            </TouchableOpacity>

            {/* Stellar exchanges credit deposits by memo. Without one, money
                sent to Binance and the like can land in the exchange's pool
                with no way to say whose it is. */}
            {currentNetwork.tag === "STELLAR" && (
              <View style={[d.card, { backgroundColor: colors.card }]}>
                <Text style={[d.amtLabel, { color: colors.mutedForeground }]}>Memo (optional)</Text>
                <TextInput
                  value={wMemo}
                  onChangeText={(t) => setWMemo(t.slice(0, 28))}
                  placeholder="Add the memo your exchange gave you"
                  placeholderTextColor={colors.mutedForeground}
                  style={[d.memoInput, { color: colors.foreground, borderColor: colors.border }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={28}
                />
                <Text style={[d.memoHint, { color: colors.mutedForeground }]}>
                  Sending to an exchange? Most need a memo to credit your account. Leave it empty for a personal wallet.
                </Text>
              </View>
            )}

            <View style={[d.card, { backgroundColor: colors.card }]}>
              <Text style={[d.amtLabel, { color: colors.mutedForeground }]}>Amount</Text>

              <View style={d.amtRow}>
                <Text style={[d.amtValue, { color: Number(wAmount) > 0 ? colors.foreground : colors.mutedForeground }]}>
                  {wAmount || "0.00"}
                </Text>
                <View style={[d.tokenChip, { backgroundColor: colors.muted }]}>
                  <TokenLogo symbol={wLogo} size={18} dark />
                  <Text style={[d.tokenChipText, { color: colors.foreground }]}>{wLabel}</Text>
                </View>
              </View>

              <Text style={[d.amtNgn, { color: colors.mutedForeground }]}>
                ≈ ₦{ngnValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>

              <View style={[d.cardRule, { backgroundColor: colors.border }]} />

              <View style={d.balRow}>
                <View>
                  <Text style={[d.balLabel, { color: colors.mutedForeground }]}>Available balance</Text>
                  <Text style={[d.balValue, { color: colors.foreground }]}>
                    {balance.toFixed(dec)} {wLabel}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[d.maxPill, { borderColor: colors.primary }]}
                  onPress={() => {
                    const factor = 10 ** dec;
                    setWAmount((Math.floor(walletMaxAmount * factor) / factor).toFixed(dec));
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[d.maxText, { color: colors.primary }]}>MAX</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[d.card, d.saveRow, { backgroundColor: colors.card }]}
              onPress={() => setSaveContact(!saveContact)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  d.checkbox,
                  saveContact
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { borderColor: colors.border },
                ]}
              >
                {saveContact && <Feather name="check" size={13} color={colors.primaryForeground} />}
              </View>
              <Text style={[d.saveText, { color: colors.foreground }]}>Save address (optional)</Text>
            </TouchableOpacity>

            {/* Fixed slot, so the keypad does not jump when a limit is hit. */}
            <Text style={[d.err, { color: belowMinimum || insufficientWallet ? colors.destructive : "transparent" }]}>
              {insufficientWallet
                ? "Insufficient funds"
                : belowMinimum
                  ? `Minimum withdrawal is ${minAmount} ${wLabel}`
                  : " "}
            </Text>
          </View>
        ) : (
          <>
            <Text style={[d.sectionLabel, { color: colors.mutedForeground }]}>Send to new recipient</Text>

            <View style={[d.card, { backgroundColor: colors.card }]}>
              <View style={d.addrRow}>
                <TextInput
                  style={[d.addrInput, { color: colors.foreground }]}
                  placeholder="Enter or paste wallet address"
                  placeholderTextColor={colors.mutedForeground}
                  value={wAddress}
                  onChangeText={setWAddress}
                  onSubmitEditing={() => confirmAddress(wAddress)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[d.pastePill, { backgroundColor: colors.muted }]}
                  onPress={async () => {
                    const text = await Clipboard.getStringAsync();
                    if (text) confirmAddress(text);
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[d.pasteText, { color: colors.foreground }]}>Paste</Text>
                </TouchableOpacity>
              </View>

              <View style={[d.cardRule, { backgroundColor: colors.border }]} />

              <TouchableOpacity style={d.scanRow} onPress={handleScan} activeOpacity={0.75}>
                <Text style={[d.scanText, { color: colors.foreground }]}>Tap to scan QR code</Text>
                <Feather name="maximize" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {invalidAddress ? (
              <Text style={[d.err, { color: colors.destructive }]}>
                {addressValidation?.error || "Invalid wallet address"}
              </Text>
            ) : wAddress.length > 0 ? (
              <TouchableOpacity
                style={[d.useBtn, { backgroundColor: colors.primary }]}
                onPress={() => confirmAddress(wAddress)}
                activeOpacity={0.85}
              >
                <Text style={[d.useBtnText, { color: colors.primaryForeground }]}>Use this address</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[d.card, d.netCard, d.spaced, { backgroundColor: colors.card }]}
              onPress={() => wNetworks.length > 1 && setShowNetworkSheet(true)}
              activeOpacity={wNetworks.length > 1 ? 0.75 : 1}
            >
              {CHAIN_MARKS[currentNetwork.tag] && (
                <Image source={CHAIN_MARKS[currentNetwork.tag]} style={d.netMark} />
              )}
              <Text style={[d.netName, { color: colors.foreground }]}>
                {currentNetwork.name || "Select network"}
              </Text>
              <Text style={[d.netBal, { color: colors.mutedForeground }]}>
                {balance.toFixed(dec)} {wLabel}
              </Text>
              {wNetworks.length > 1 && (
                <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>

            <Text style={[d.sectionLabel, { color: colors.mutedForeground }]}>Send to beneficiary</Text>

            <View style={[d.card, { backgroundColor: colors.card, paddingTop: 10 }]}>
              <View style={d.tabs}>
                {(["recent", "favourites"] as const).map((t) => (
                  <TouchableOpacity key={t} onPress={() => setTab(t)} style={d.tab} activeOpacity={0.7}>
                    <Text
                      style={[
                        d.tabText,
                        { color: tab === t ? colors.primary : colors.mutedForeground },
                      ]}
                    >
                      {t === "recent" ? "Recent" : "Favourites"}
                    </Text>
                    {tab === t && <View style={[d.tabBar, { backgroundColor: colors.primary }]} />}
                  </TouchableOpacity>
                ))}
              </View>

              {shown.length === 0 ? (
                <Text style={[d.contactEmpty, { color: colors.mutedForeground }]}>
                  {tab === "recent"
                    ? `No recent ${currentNetwork.name || ""} addresses yet.`
                    : "No favourites yet. Tick \u201cSave address\u201d when you send."}
                </Text>
              ) : (
                shown.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={d.contactRow}
                    onPress={() => confirmAddress(c.address)}
                    activeOpacity={0.75}
                  >
                    <View style={[d.contactDisc, { backgroundColor: colors.muted }]}>
                      <Feather name="user" size={15} color={colors.mutedForeground} />
                    </View>
                    <View style={{ flex: 1 }}>
                      {!!c.label && (
                        <Text style={[d.contactLabel, { color: colors.foreground }]} numberOfLines={1}>
                          {c.label}
                        </Text>
                      )}
                      <Text
                        style={[c.label ? d.contactAddrSub : d.contactLabel, { color: c.label ? colors.mutedForeground : colors.foreground }]}
                        numberOfLines={1}
                      >
                        {short(c.address)}
                      </Text>
                    </View>
                    {c.favourite && <Feather name="star" size={14} color={colors.primary} />}
                  </TouchableOpacity>
                ))
              )}
            </View>

            <View style={[d.warn, { backgroundColor: colors.warning + "14" }]}>
              <Feather name="alert-triangle" size={15} color={colors.warning} />
              <Text style={[d.warnText, { color: colors.warning }]}>
                Sending to the wrong address or network loses the funds permanently.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* The pad only belongs on screen once there is an amount to type. */}
      {!!recipient && (
        <View style={d.dock}>
          <TouchableOpacity
            style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: amountReady ? 1 : 0.4, marginHorizontal: 16 }]}
            onPress={handleProceed}
            disabled={!amountReady}
            activeOpacity={0.85}
          >
            <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Next</Text>
          </TouchableOpacity>

          <Keypad
            decimal
            style={[d.pad, { paddingBottom: bottomPad + 6 }]}
            onKey={handleAmountKey}
            onBackspace={() => setWAmount(wAmount.slice(0, -1))}
          />
        </View>
      )}

      {/* Network selector modal */}
      {showNetworkSheet && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity style={ts.modalOverlay} activeOpacity={1} onPress={() => setShowNetworkSheet(false)}>
            <View
              style={[ts.bankSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[ts.handle, { alignSelf: "center", backgroundColor: colors.primary }]} />
              <View style={d.sheetHead}>
                {/* The monochrome mark brings its own disc; the tinted circle
                    that used to sit under it was a second disc. */}
                <TokenLogo symbol={wLogo} size={46} dark />
                <Text style={[d.sheetTitle, { color: colors.foreground }]}>Select network</Text>
              </View>

              <View style={d.netList}>
                {/* Only chains actually holding this token. An empty chain is
                    not a choice - listing it just to show 0.0000 made the sheet
                    longer without making it more useful. */}
                {fundedNetworks.length === 0 && (
                  <Text style={[d.netEmpty, { color: colors.mutedForeground }]}>
                    No {wLabel} on any network yet.
                  </Text>
                )}
                {fundedNetworks.map((net) => {
                  const netBal = networkBalance(net.tag);
                  const active = currentNetwork.tag === net.tag;
                  return (
                    <TouchableOpacity
                      key={net.tag}
                      style={[d.netRow, { backgroundColor: colors.background }]}
                      onPress={() => { setCurrentNetwork(net); setShowNetworkSheet(false); }}
                      activeOpacity={0.75}
                    >
                      {CHAIN_MARKS[net.tag] ? (
                        <Image source={CHAIN_MARKS[net.tag]} style={d.netRowMark} />
                      ) : (
                        <View style={[d.netRowMark, { backgroundColor: colors.muted }]} />
                      )}
                      <Text style={[d.netRowName, { color: colors.foreground }]}>{net.name}</Text>
                      <Text style={[d.netRowBal, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {netBal.toFixed(dec)}
                      </Text>
                      {active ? (
                        <Feather name="check" size={18} color={colors.primary} />
                      ) : (
                        <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* QR Scanner Modal */}
      {showScanner && (
        <Modal transparent animationType="slide" visible>
          <View style={scanStyles.scannerContainer}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                // A QR may hold the bare address or a payment URI, and the
                // schemes disagree about where in it the address sits - see
                // addressFromScan, which picks the piece that validates.
                const address = addressFromScan(data, currentNetwork.tag);
                // Straight to the recipient card: a scanned address was chosen
                // deliberately, so making the user confirm it again is a tap
                // for nothing.
                confirmAddress(address);
                setShowScanner(false);
              }}
            />
            {/* Overlay with cutout */}
            <View style={scanStyles.overlay}>
              <View style={scanStyles.overlayTop} />
              <View style={scanStyles.overlayMiddle}>
                <View style={scanStyles.overlaySide} />
                <View style={scanStyles.cutout}>
                  {/* Corner markers */}
                  <View style={[scanStyles.corner, scanStyles.tl]} />
                  <View style={[scanStyles.corner, scanStyles.tr]} />
                  <View style={[scanStyles.corner, scanStyles.bl]} />
                  <View style={[scanStyles.corner, scanStyles.br]} />
                </View>
                <View style={scanStyles.overlaySide} />
              </View>
              <View style={scanStyles.overlayBottom}>
                <Text style={scanStyles.scanText}>Scan wallet QR code</Text>
              </View>
            </View>
            {/* Close button */}
            <TouchableOpacity style={scanStyles.closeBtn} onPress={() => setShowScanner(false)}>
              <Feather name="x" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      <KeyboardDoneBar />
    </View>
  );
}

const CUTOUT = 250;

const scanStyles = StyleSheet.create({
  iconBtn: {
    padding: 8,
    marginLeft: 4,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  overlayTop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayMiddle: { flexDirection: "row", height: CUTOUT },
  overlaySide: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  cutout: { width: CUTOUT, height: CUTOUT },
  overlayBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", paddingTop: 24 },
  scanText: { color: "#fff", fontSize: 15, fontFamily: "Inter_500Medium" },
  corner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#fff",
  },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  closeBtn: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});

/** The two-step send layout. Kept apart from the scanner's styles. */
const d = StyleSheet.create({
  sectionLabel: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14 },
  stack: { paddingTop: 12, gap: 12 },
  // The section labels carry their own top margin; a card that follows another
  // card without one has nothing separating them.
  spaced: { marginTop: 12 },
  cardRule: { height: StyleSheet.hairlineWidth, marginVertical: 12, marginHorizontal: -16 },

  addrRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  addrInput: { flex: 1, fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_500Medium", paddingVertical: 6 },
  pastePill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  pasteText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  scanRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scanText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },

  netCard: { flexDirection: "row", alignItems: "center", gap: 11 },
  netMark: { width: 26, height: 26, borderRadius: 13 },
  netName: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  netBal: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_500Medium" },

  err: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 22,
    marginTop: 8,
  },

  warn: { flexDirection: "row", gap: 9, marginHorizontal: 16, marginTop: 18, padding: 13, borderRadius: 14 },
  warnText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_500Medium" },

  recipHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  recipLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  recipAddr: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold", marginTop: 9 },
  recipNet: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 9 },
  recipNetLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  recipNetMark: { width: 16, height: 16, borderRadius: 8 },
  recipNetName: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  amtLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium" },
  memoInput: {
    marginTop: 8,
    height: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  memoHint: { marginTop: 8, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },

  amtRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  // The figure carries the screen; everything else on the card is support.
  amtValue: { flex: 1, fontSize: 34, lineHeight: 42, fontFamily: "Inter_800ExtraBold", letterSpacing: -1 },
  tokenChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 7, paddingRight: 12, paddingVertical: 6, borderRadius: 999 },
  tokenChipText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  amtNgn: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 4 },

  balRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  balLabel: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular" },
  balValue: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_700Bold", marginTop: 2 },
  maxPill: { paddingHorizontal: 15, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5 },
  maxText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },

  useBtn: { marginHorizontal: 16, marginTop: 12, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  useBtnText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_700Bold" },

  tabs: { flexDirection: "row", gap: 22, marginBottom: 6 },
  tab: { paddingBottom: 8 },
  tabText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  tabBar: { height: 2, borderRadius: 1, marginTop: 6 },

  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  contactDisc: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  contactAddrSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  contactEmpty: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 30 },

  saveRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  saveText: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },

  sheetHead: { alignItems: "center", paddingTop: 4, paddingBottom: 22 },
  sheetTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, marginTop: 14 },
  netList: { gap: 10 },
  netEmpty: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 26 },
  // On the background rather than the card, so each row reads as a well cut
  // into the sheet instead of a box drawn on it.
  netRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 14, height: 62, borderRadius: 16 },
  netRowMark: { width: 30, height: 30, borderRadius: 15 },
  netRowName: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  netRowBal: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },

  // Button above the pad, both pinned: the amount scrolls, the controls do not.
  dock: { marginTop: "auto" },
  // The keys are flex:1, so a full-bleed pad stretches them to the screen
  // edges. In the PIN sheets a card's padding does this job; out here the pad
  // has to bound itself, and the cap keeps the proportions on a wide screen.
  pad: { width: "100%", maxWidth: 380, alignSelf: "center", paddingHorizontal: 22, marginTop: 14 },
});
