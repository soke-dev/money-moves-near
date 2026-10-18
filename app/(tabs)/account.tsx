import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Modal,
  Image,
  Linking,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import ThemeToggle from "@/components/ThemeToggle";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getServerUrl } from "@/services/api";
import { avatarKey } from "@/services/user";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import ViewShot from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { DashedRule, SLIP_MONO } from "@/components/Slip";
import {
  DISPLAY_CURRENCIES,
  getDisplayCurrency,
  setDisplayCurrency,
  type DisplayCurrency,
} from "@/services/display-currency";
import { getRates, type RatesResponse } from "@/services/rates";
import { TokenLogo } from "@/components/TokenLogo";

/** The tokens the rate feed carries, in the order the sheet lists them. */
const RATE_SYMBOLS = ["USDC", "USDT", "MOVE", "cNGN"] as const;

/**
 * Which of them you can actually buy with naira.
 *
 * Funding settles in USDC - see FIAT_SETTLES - so a fund rate beside MOVE or
 * cNGN prices something nobody can buy, and reads as an offer the app will not
 * honour. They sell, and the column says nothing where there is nothing to say.
 */
const FUNDABLE = new Set(["USDC", "USDT"]);

interface MenuItemProps {
  /** A drawn mark. Preferred; `icon` is the fallback where none exists. */
  img?: any;
  icon?: string;
  title: string;
  /** One line under the title. Say something the title does not. */
  subtitle?: string;
  /** For a subtitle that is a status rather than a description. */
  subtitleColor?: string;
  onPress: () => void;
  /** Hides the seam under the last row of a group. */
  last?: boolean;
  /** Tints the tile and the title, for the destructive row. */
  danger?: boolean;
  /** A short state shown before the chevron. */
  value?: string;
}

function MenuItem({ img, icon, title, subtitle, subtitleColor, onPress, last, danger, value }: MenuItemProps) {
  const colors = useColors();
  const tint = danger ? colors.destructive : colors.foreground;
  return (
    <TouchableOpacity
      style={[
        styles.menuItem,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* A rounded square, not a circle: it sits with the app icon and keeps
          the column of glyphs the same width whatever the glyph is. */}
      <View style={[styles.menuIcon, { backgroundColor: danger ? colors.destructive + "1A" : colors.muted }]}>
        {img ? (
          // Tinted, so a set of marks drawn in different colours still reads
          // as one column.
          <Image
            source={img}
            style={[styles.menuMark, { tintColor: danger ? colors.destructive : colors.mutedForeground }]}
            resizeMode="contain"
          />
        ) : (
          <Feather name={icon as any} size={17} color={danger ? colors.destructive : colors.mutedForeground} />
        )}
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: tint }]}>{title}</Text>
        {!!subtitle && (
          <Text
            style={[styles.menuSubtitle, { color: subtitleColor ?? colors.mutedForeground }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {!!value && (
        <View style={[styles.valuePill, { backgroundColor: colors.muted }]}>
          <Text style={[styles.valueText, { color: colors.foreground }]}>{value}</Text>
        </View>
      )}
      {!danger && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
    </TouchableOpacity>
  );
}

/** A labelled group of rows. */
function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.menuCard, { backgroundColor: colors.card }]}>{children}</View>
    </>
  );
}

export default function AccountScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [showKycModal, setShowKycModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [displayCurrency, setCurrency] = useState<DisplayCurrency>("NGN");
  const [showCurrency, setShowCurrency] = useState(false);
  // Fetched when the sheet opens rather than on mount: most visits to this
  // screen are not about rates, and the numbers go stale in ten minutes.
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [ratesFailed, setRatesFailed] = useState(false);
  const [showTagCode, setShowTagCode] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getDisplayCurrency().then(setCurrency);
    }, []),
  );

  useEffect(() => {
    if (!showCurrency) return;
    let alive = true;
    setRatesFailed(false);
    getRates()
      .then((r) => alive && setRates(r))
      .catch(() => alive && setRatesFailed(true));
    return () => {
      alive = false;
    };
  }, [showCurrency]);

  /**
   * The one announcement a newly verified account gets.
   *
   * The verification sheet closes without a word of its own, so this is where
   * being cleared is actually told to someone - and it leads with the numbers
   * that changed, which is the part worth knowing. Marked against the account
   * so it happens once and does not greet them every time they open this
   * screen; the row above still opens it on demand.
   */
  useEffect(() => {
    if (!user?.id || !user.verified) return;
    const key = `mm_limits_shown_${user.id}`;
    let alive = true;
    AsyncStorage.getItem(key)
      .then((seen) => {
        if (!alive || seen) return;
        AsyncStorage.setItem(key, "1").catch(() => {});
        setShowKycModal(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id, user?.verified]);

  useFocusEffect(
    useCallback(() => {
      refreshUser();
      if (user?.avatarUrl) {
        const u = user.avatarUrl;
        // Avatars are now DB-stored data URIs; only legacy relative paths need the server prefix.
        setAvatar(u.startsWith("data:") || u.startsWith("http") ? u : `${getServerUrl()}${u}`);
      } else {
        AsyncStorage.getItem(avatarKey(user?.id)).then((uri) => setAvatar(uri));
      }
    }, [user?.avatarUrl, user?.id])
  );

  const codeShotRef = useRef<ViewShot>(null);

  /**
   * The card, as a picture somebody can send.
   *
   * A code you can only hold up to another phone is a code you can only give
   * to someone in the room. It leaves as a PNG rather than the PDF the receipt
   * produces, because this one goes into a chat thread - and a thread shows a
   * picture where it shows a document as a paperclip.
   *
   * What is captured is the framed card, dark border and all, so the punched
   * corners of the tear have the same ground behind them in the image that
   * they have on the screen.
   */
  const handleShareCode = async () => {
    try {
      const uri = await (codeShotRef.current as any)?.capture?.();
      if (!uri) return;

      if (Platform.OS === "web") {
        const nav: any = typeof navigator !== "undefined" ? navigator : null;
        const blob = await (await fetch(uri)).blob();
        const name = `money-moves-${user?.username || "code"}.png`;
        const file = new File([blob], name, { type: "image/png" });
        if (nav?.canShare?.({ files: [file] })) {
          await nav.share({ files: [file] });
          return;
        }
        const link = document.createElement("a");
        link.href = uri;
        link.download = name;
        link.click();
        return;
      }

      if (!(await Sharing.isAvailableAsync())) return;
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Share your Money Moves code",
        UTI: "public.png",
      });
    } catch (err) {
      // A share sheet that never opened is not worth an alert: the code is
      // still on screen, and the handle is still copyable from the row above.
      console.warn("[ACCOUNT] code share failed:", err);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    setShowLogoutModal(false);
    logout();
    router.replace("/auth/dynamic-onboarding");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 124 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Centred title, the way a profile page is titled rather than a
            list screen. */}
        <View style={[styles.pageHead, { paddingTop: topPad + 10 }]}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Account</Text>
        </View>

        <View style={styles.profileSection}>
          <TouchableOpacity
            onPress={() => router.push("/account/profile")}
            activeOpacity={0.85}
            style={styles.avatarWrap}
          >
            <View style={[styles.avatarLarge, { backgroundColor: colors.muted }]}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatarImage} resizeMode="cover" />
              ) : (
                /* A glyph, not anon.png: that artwork is a black silhouette on
                   an opaque white square, so clipped to a circle on a dark
                   screen it reads as a white disc with a blob in it. */
                <Feather name="user" size={42} color={colors.mutedForeground} />
              )}
            </View>
            {/* The badge says the picture is changeable without a caption
                saying so. */}
            <View style={[styles.avatarBadge, { backgroundColor: colors.muted, borderColor: colors.background }]}>
              <Image
                source={require("@/assets/images/edit.png")}
                style={[styles.badgeMark, { tintColor: colors.foreground }]}
                resizeMode="contain"
              />
            </View>
          </TouchableOpacity>

          <View style={styles.nameRow}>
            <Text style={[styles.userName, { color: colors.foreground }]} numberOfLines={1}>
              {[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username}
            </Text>
            {/* The mark sits with the name, where a verified badge belongs,
                rather than as a pill lower down repeating the same fact. */}
            {user?.verified && (
              <Image
                source={require("@/assets/images/checklist-green.png")}
                style={styles.verifiedMark}
                resizeMode="contain"
              />
            )}
          </View>
        </View>

        {/* The handle, boxed. It is how other people pay you, which is worth
            more room than a line under the name. */}
        {/* Two cards on one row: the handle on the left over two lines, and
            Loyalty as a tile beside it, built like the bills cards - an
            oversized mark clipped by the card, reading as texture rather than
            an icon that happens to be big. */}
        <View style={styles.tagRow}>
          <View style={[styles.tagCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.tagHead}>
              <Feather name="at-sign" size={12} color={colors.primary} />
              <Text style={[styles.tagLabel, { color: colors.mutedForeground }]}>YOUR USERNAME</Text>
            </View>

            <View style={styles.handleRow}>
              <Text style={[styles.tagHandle, { color: colors.foreground }]} numberOfLines={1}>
                @{user?.username}
              </Text>
              <TouchableOpacity
                style={[styles.copyBtn, { backgroundColor: colors.muted }]}
                onPress={() => {
                  Clipboard.setStringAsync(user?.username || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
                hitSlop={8}
                activeOpacity={0.75}
              >
                <Feather name={copied ? "check" : "copy"} size={12} color={colors.primary} />
                <Text style={[styles.copyText, { color: colors.primary }]}>{copied ? "Copied" : "Copy"}</Text>
              </TouchableOpacity>

              {/* The same handle, in a form someone can point a camera at. */}
              <TouchableOpacity
                style={[styles.codeBtn, { backgroundColor: colors.muted }]}
                onPress={() => setShowTagCode(true)}
                hitSlop={8}
                activeOpacity={0.75}
              >
                <Image
                  source={require("@/assets/images/qr-code.png")}
                  style={[styles.codeMark, { tintColor: colors.primary }]}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.loyaltyCard, { backgroundColor: colors.card }]}
            onPress={() => router.push("/referrals")}
            activeOpacity={0.8}
          >
            <View style={styles.loyaltyArt} pointerEvents="none">
              <Image
                source={require("@/assets/images/brand.png")}
                style={[styles.loyaltyArtImg, { tintColor: colors.primary }]}
                resizeMode="contain"
              />
            </View>

            <Image
              source={require("@/assets/images/brand.png")}
              style={[styles.loyaltyMark, { tintColor: colors.primary }]}
              resizeMode="contain"
            />
            <Text style={[styles.loyaltyText, { color: colors.foreground }]}>
              Loyalty{"\n"}and rewards
            </Text>

          </TouchableOpacity>
        </View>

        <MenuGroup label="PROFILE">
          <MenuItem
            img={require("@/assets/images/user (2).png")}
            title="My profile"
            subtitle="Name, photo and contact details"
            onPress={() => router.push("/account/profile")}
          />
          <MenuItem
            img={require("@/assets/images/id-card.png")}
            title="Identity verification"
            subtitle={user?.verified ? "Verified" : "Not verified"}
            // Amber, not the same grey as every other caption: this one is a
            // thing to do rather than a fact about the account.
            subtitleColor={user?.verified ? undefined : "#f59e0b"}
            onPress={() => (user?.verified ? setShowKycModal(true) : router.push("/account/kyc"))}
          />
          {/* With the profile rather than under money: a referral code is part
              of who you are here, and nothing about it moves a balance. */}
          {/* In a new account's first week it says what else is behind it:
              "Invite friends" reads as sharing your own code, and nobody
              looking for where to type a friend's would tap it otherwise. */}
          <MenuItem
            icon="user-plus"
            title="Invite friends"
            subtitle={
              user?.referralClaim?.open
                ? `Add a friend's code · ${
                    user.referralClaim.daysLeft === 1 ? "last day" : `${user.referralClaim.daysLeft} days left`
                  }`
                : "Your code, and who joined with it"
            }
            subtitleColor={user?.referralClaim?.open ? "#f59e0b" : undefined}
            onPress={() => router.push("/referral-dashboard" as any)}
            last
          />
        </MenuGroup>

        <MenuGroup label="MONEY">
          <MenuItem
            img={require("@/assets/images/transaction.png")}
            title="Transactions"
            subtitle="Everything you have sent and received"
            onPress={() => router.push("/transactions")}
          />
          <MenuItem
            img={require("@/assets/images/people.png")}
            title="Beneficiaries"
            subtitle="Saved bank accounts and wallet addresses"
            onPress={() => router.push("/beneficiaries")}
          />
          <MenuItem
            img={require("@/assets/images/stop.png")}
            title="Spending limits"
            subtitle="What you can move per day"
            onPress={() => router.push("/account/limits")}
            last
          />
        </MenuGroup>

        <MenuGroup label="GENERAL">
          <MenuItem
            img={require("@/assets/images/lock.png")}
            title="Security"
            subtitle="PIN, password, biometrics and wallet backup"
            onPress={() => router.push("/account/security")}
          />
          <MenuItem
            img={require("@/assets/images/bell (1).png")}
            title="Notifications"
            subtitle="What you hear about, and how"
            onPress={() => router.push("/account/notifications-settings")}
          />
          <MenuItem
            img={require("@/assets/images/change.png")}
            title="Currency display and rates"
            subtitle="What your balances are shown in, and today's rates"
            value={displayCurrency}
            onPress={() => setShowCurrency(true)}
          />
          <ThemeToggle />
        </MenuGroup>

        <MenuGroup label="ABOUT">
          <MenuItem
            img={require("@/assets/images/customer-service.png")}
            title="Help and support"
            subtitle="Chat, guides and how to reach us"
            onPress={() => router.push("/account/support")}
            last
          />
        </MenuGroup>

        <View style={[styles.menuCard, { backgroundColor: colors.card, marginTop: 22 }]}>
          <MenuItem icon="log-out" title="Log out" onPress={handleLogout} danger last />
        </View>

        {/* The mark, faded, and what shipped. Read from the manifest so it
            cannot drift from the build. */}
        <View style={styles.footer}>
          <Image
            source={require("@/assets/images/logo-lockup.png")}
            style={[styles.footerMark, { tintColor: colors.foreground }]}
            resizeMode="contain"
          />
          <Text style={[styles.version, { color: colors.mutedForeground }]}>
            {/* Read from the manifest so it cannot drift from the build, and
                each platform shows its own build number - this printed the iOS
                one on Android, where it means nothing. */}
            Version {Constants.expoConfig?.version ?? "—"}
            {(() => {
              const build =
                Platform.OS === "android"
                  ? Constants.expoConfig?.android?.versionCode
                  : Constants.expoConfig?.ios?.buildNumber;
              return build ? ` (${build})` : "";
            })()}
          </Text>
        </View>

      </ScrollView>

      {/* Currency display and rates */}
      {showCurrency && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={styles.sheetOverlay}
            activeOpacity={1}
            onPress={() => setShowCurrency(false)}
          >
            <View
              style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              {/* A grip rather than a close button in a corner: the sheet is
                  dismissed by tapping away or dragging, and a filled circle at
                  the top right of a two-row list is more furniture than it
                  needs. */}
              <View style={[styles.sheetGrip, { backgroundColor: colors.border }]} />

              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                Currency display and rates
              </Text>
              <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                Changes what you see. What you hold, and what anything is sent or paid
                out in, stays the same.
              </Text>

              {/* One card, hairline-separated, the way every other list on this
                  screen is drawn. The choice is marked by a tick and a filled
                  code - not by a lit border around the whole row. */}
              <View style={[styles.ccyCard, { backgroundColor: colors.card }]}>
                {DISPLAY_CURRENCIES.map((c, i) => {
                  const active = c.code === displayCurrency;
                  return (
                    <TouchableOpacity
                      key={c.code}
                      style={[
                        styles.ccyRow,
                        i < DISPLAY_CURRENCIES.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.border,
                        },
                      ]}
                      onPress={async () => {
                        setCurrency(c.code);
                        await setDisplayCurrency(c.code);
                        setShowCurrency(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.ccyFlag}>{c.flag}</Text>
                      <Text
                        style={[
                          styles.ccyCode,
                          {
                            color: colors.foreground,
                            fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                          },
                        ]}
                      >
                        {c.code}
                      </Text>
                      <Text style={[styles.ccyName, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      {active && <Feather name="check" size={16} color={colors.foreground} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Today's rates, both directions.
                  Which unit the app prints is only half the question - the
                  other half is what one converts into, which is the number
                  people actually came here to check. */}
              <Text style={[styles.ratesLabel, { color: colors.mutedForeground }]}>
                TODAY&apos;S RATES
              </Text>
              <View style={[styles.ccyCard, { backgroundColor: colors.card }]}>
                {/* Column headings once, at the top, rather than the words
                    "buy" and "sell" repeated beside all eight figures. */}
                <View style={[styles.rateRow, styles.rateHead]}>
                  <View style={styles.rateNames} />
                  {/* Fund, not buy: it is the word the deposit flow uses, and
                      the column is what a naira deposit converts at. */}
                  <Text style={[styles.rateColHead, { color: colors.mutedForeground }]}>FUND</Text>
                  <Text style={[styles.rateColHead, { color: colors.mutedForeground }]}>SELL</Text>
                </View>

                {RATE_SYMBOLS.map((sym, i) => {
                  const r = rates?.[sym];
                  // The fund side: what a naira deposit converts at. Falls
                  // back to the sell rate if the feed omits it.
                  const fundable = FUNDABLE.has(sym);
                  const buy = r ? r.fundNgn || r.ngn : 0;
                  const sell = r?.ngn ?? 0;
                  const unit = sym === "USDC" || sym === "USDT" ? "$1" : `1 ${sym}`;
                  /**
                    * Whole naira for a token worth many of them, decimals for
                    * one worth about one. Rounding kicked in at ₦1, which is
                    * fine for USDC at ₦1,358 and wrong for cNGN: its fund rate
                    * of ₦1.0189 printed as "₦1", hiding the only digits on
                    * that row anybody is reading it for.
                    */
                  const money = (v: number) =>
                    v < 10
                      ? `₦${v.toFixed(4)}`
                      : v < 1000
                        ? `₦${v.toFixed(2)}`
                        : `₦${Math.round(v).toLocaleString()}`;
                  const blank = ratesFailed ? "—" : "…";
                  return (
                    <View
                      key={sym}
                      style={[
                        styles.rateRow,
                        i < RATE_SYMBOLS.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.rateNames}>
                        <TokenLogo symbol={sym} size={24} dark />
                        <Text style={[styles.rateSym, { color: colors.foreground }]}>{sym}</Text>
                        <Text style={[styles.rateUnit, { color: colors.mutedForeground }]}>{unit}</Text>
                      </View>
                      <Text
                        style={[
                          styles.rateFig,
                          { color: fundable ? colors.foreground : colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {!fundable ? "—" : r ? money(buy) : blank}
                      </Text>
                      <Text style={[styles.rateFig, { color: colors.foreground }]} numberOfLines={1}>
                        {r ? money(sell) : blank}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <Text style={[styles.ratesFoot, { color: colors.mutedForeground }]}>
                Refreshed every 10 minutes. The rate you get is the one quoted when you
                confirm.
              </Text>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {showTagCode && (
        <Modal transparent animationType="fade" visible>
          <TouchableOpacity
            style={styles.codeOverlay}
            activeOpacity={1}
            onPress={() => setShowTagCode(false)}
          >
            <View style={styles.codeStack} onStartShouldSetResponder={() => true}>
              {/* Captured whole, frame included - see handleShareCode. */}
              <ViewShot
                ref={codeShotRef}
                options={{ format: "png", quality: 1, result: "tmpfile" }}
              >
                <View style={[styles.codeFrame, { backgroundColor: colors.background }]}>
                  {/* The slip the confirm screens are built from, carrying a
                      code where they carry a figure. Same PAY TO, same tear,
                      same monospace footer - so the card someone is handed
                      looks like the app it came from, and no new shape had to
                      be invented to hand it to them.

                      Nothing may sit behind this card: the punched corners of
                      the tear are circles painted in the screen's own
                      background colour, not holes. */}
                  <View style={[styles.slip, { backgroundColor: colors.card }]}>
                    <View style={styles.slipHead}>
                      <View style={[styles.slipFace, { backgroundColor: colors.muted }]}>
                        {avatar ? (
                          <Image source={{ uri: avatar }} style={styles.slipFaceImg} resizeMode="cover" />
                        ) : (
                          <Feather name="user" size={19} color={colors.mutedForeground} />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.slipLabel, { color: colors.mutedForeground }]}>PAY TO</Text>
                        <Text style={[styles.slipTag, { color: colors.foreground }]} numberOfLines={1}>
                          @{user?.username}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.slipWaist}>
                      <View style={[styles.slipNotch, styles.slipNotchLeft, { backgroundColor: colors.background }]} />
                      <View style={styles.slipPerf}>
                        <DashedRule color={colors.border} dash={5} gap={4} thickness={1.5} />
                      </View>
                      <View style={[styles.slipNotch, styles.slipNotchRight, { backgroundColor: colors.background }]} />
                    </View>

                    {/* White panel whatever the theme: a dark QR on a dark card
                        is one most scanners will not read. */}
                    <View style={styles.codePanel}>
                      <QRCode
                        value={user?.username || " "}
                        size={196}
                        backgroundColor="#fff"
                        color="#000"
                        logo={require("@/assets/images/logo-qr.png")}
                        logoSize={40}
                        logoBackgroundColor="#fff"
                        logoBorderRadius={20}
                        logoMargin={4}
                      />
                    </View>

                    <View style={styles.slipFoot}>
                      <Text style={[styles.slipFootText, { color: colors.mutedForeground }]}>MONEY MOVES</Text>
                      <Text style={[styles.slipFootText, { color: colors.mutedForeground }]}>SCAN TO PAY</Text>
                    </View>
                  </View>
                </View>
              </ViewShot>

              <View style={styles.codeActions}>
                <TouchableOpacity
                  style={[styles.codeAction, { backgroundColor: colors.muted }]}
                  onPress={() => setShowTagCode(false)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.codeActionText, { color: colors.foreground }]}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.codeAction, { backgroundColor: colors.primary }]}
                  onPress={handleShareCode}
                  activeOpacity={0.85}
                >
                  <Feather name="share" size={15} color={colors.primaryForeground} />
                  <Text style={[styles.codeActionText, { color: colors.primaryForeground }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Verified — a sheet, not a centred card.
          A centred dialog with a haloed tick says "well done" and nothing
          else. What someone wants at this moment is the numbers that just
          changed, so the sheet rises from the bottom where every other sheet
          in the app does, and leads with them. */}
      {showKycModal && (
        <Modal transparent animationType="slide" visible statusBarTranslucent>
          <View style={styles.vsOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowKycModal(false)} />
            <View
              style={[
                styles.vsSheet,
                { backgroundColor: colors.background, paddingBottom: insets.bottom + 18 },
              ]}
            >
              <View style={[styles.vsHandle, { backgroundColor: colors.border }]} />

              <View style={styles.vsHead}>
                <Image
                  source={require("@/assets/images/checklist-green.png")}
                  style={styles.vsMark}
                  resizeMode="contain"
                />
                <Text style={[styles.vsEyebrow, { color: colors.primary }]}>VERIFIED</Text>
              </View>

              <Text style={[styles.vsTitle, { color: colors.foreground }]}>
                Your limits just{"\n"}went up.
              </Text>

              <View style={[styles.vsRule, { backgroundColor: colors.border }]} />

              {[
                ["Bank transfers", "₦2,000,000 a day"],
                ["Fund with naira", "₦200,000 a day"],
                ["Airtime and data", "₦10,000 a day"],
                ["Electricity", "₦20,000 a day"],
              ].map(([k, v]) => (
                <View key={k} style={styles.vsRow}>
                  <Text style={[styles.vsRowK, { color: colors.mutedForeground }]}>{k}</Text>
                  <Text style={[styles.vsRowV, { color: colors.foreground }]}>{v}</Text>
                </View>
              ))}

              <Text style={[styles.vsFoot, { color: colors.mutedForeground }]}>
                Crypto and username transfers were never capped, and still are not.
              </Text>

              <TouchableOpacity
                style={[styles.vsBtn, { backgroundColor: colors.primary }]}
                onPress={() => setShowKycModal(false)}
                activeOpacity={0.85}
              >
                <Text style={[styles.vsBtnText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <Modal transparent animationType="fade" visible>
          <TouchableOpacity style={styles.dialogOverlay} activeOpacity={1} onPress={() => setShowLogoutModal(false)}>
            <View style={[styles.outCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
              {/* No warning halo. Logging out is neither an error nor a thing
                  that loses anything, and a red circle over a routine, undoable
                  action spends alarm it cannot pay back. Left-aligned, like the
                  list it was opened from. */}
              <Text style={[styles.outTitle, { color: colors.foreground }]}>Log out?</Text>
              <Text style={[styles.outBody, { color: colors.mutedForeground }]}>
                {user?.username
                  ? `Signing back in as @${user.username} takes a code from your email, then your PIN.`
                  : "Signing back in takes a code from your email, then your PIN."}
              </Text>

              {/* Staying is the solid button and leaving is the quiet one: a
                  mis-tap on the prominent control should be the harmless
                  outcome, and before this the bright one signed you out. */}
              <TouchableOpacity
                style={[styles.outStay, { backgroundColor: colors.foreground }]}
                onPress={() => setShowLogoutModal(false)}
                activeOpacity={0.85}
              >
                <Text style={[styles.outStayText, { color: colors.background }]}>Stay signed in</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.outGo} onPress={confirmLogout} activeOpacity={0.7}>
                <Text style={[styles.outGoText, { color: colors.destructive }]}>Log out</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pageHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  pageTitle: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  profileSection: { alignItems: "center", paddingTop: 18, paddingBottom: 16 },
  avatarWrap: { width: 96, height: 96 },
  avatarLarge: { width: 96, height: 96, borderRadius: 48, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImage: { width: "100%", height: "100%" },
  badgeMark: { width: 14, height: 14 },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingHorizontal: 24 },
  userName: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_700Bold", letterSpacing: -0.3, flexShrink: 1 },
  verifiedMark: { width: 17, height: 17 },

  // Outlined rather than filled: it is the one thing on the page worth
  // drawing a box around.





  tagRow: { flexDirection: "row", gap: 10, marginHorizontal: 16, alignItems: "stretch" },

  tagCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: "center",
  },
  tagHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  tagLabel: { fontSize: 9.5, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  handleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 },
  tagHandle: { flexShrink: 1, fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  copyText: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  codeBtn: { width: 26, height: 26, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  codeMark: { width: 13, height: 13 },

  /**
   * Nearly opaque, where this was a 60% scrim.
   *
   * The tear's corners are circles painted in the background colour rather
   * than holes cut out of the card, so whatever shows through behind them has
   * to be that colour or they read as two dark blots. Dimming the page almost
   * away suits the moment as well: this is a thing you hold up to someone.
   */
  codeOverlay: {
    flex: 1,
    backgroundColor: "rgba(10,10,10,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  codeStack: { alignSelf: "stretch" },
  // The dark border the shared image keeps, so the punched corners have the
  // same ground behind them in a chat thread that they have on the screen.
  codeFrame: { borderRadius: 26, padding: 14 },

  slip: { borderRadius: 18, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, overflow: "hidden" },
  slipHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  slipFace: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  slipFaceImg: { width: "100%", height: "100%" },
  slipLabel: { fontSize: 9.5, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 1.7 },
  slipTag: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4, marginTop: 3 },

  // Height is the notch, so the circles sit centred on the line.
  slipWaist: { height: 20, marginTop: 16, marginHorizontal: -18, justifyContent: "center" },
  slipPerf: { marginHorizontal: 14 },
  slipNotch: { position: "absolute", top: 0, width: 20, height: 20, borderRadius: 10 },
  slipNotchLeft: { left: -10 },
  slipNotchRight: { right: -10 },

  codePanel: { backgroundColor: "#fff", borderRadius: 14, padding: 13, marginTop: 16, alignItems: "center" },
  slipFoot: { flexDirection: "row", justifyContent: "space-between", marginTop: 13 },
  slipFootText: { fontSize: 10, lineHeight: 14, fontFamily: SLIP_MONO, letterSpacing: 0.6 },

  codeActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  codeAction: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  codeActionText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_700Bold" },

  loyaltyCard: { width: 132, borderRadius: 20, padding: 14, overflow: "hidden", justifyContent: "flex-end" },
  // Oversized and clipped by the card, the way the bills tiles carry theirs.
  loyaltyArt: { position: "absolute", right: -18, top: -20, opacity: 0.13 },
  loyaltyArtImg: { width: 96, height: 96 },
  loyaltyMark: { width: 22, height: 22, marginBottom: 8 },
  loyaltyText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  groupLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 22,
  },
  menuCard: { marginHorizontal: 16, borderRadius: 18, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 14, paddingVertical: 13 },
  menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  menuSubtitle: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
  menuMark: { width: 18, height: 18 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 18 },
  sheetTitle: { fontSize: 19, lineHeight: 25, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.4 },
  sheetGrip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 5, marginBottom: 16 },

  // The rows share one card and are separated by the same hairline as the menu
  // above, so the picker reads as part of this screen rather than a panel of
  // its own.
  ccyCard: { borderRadius: 16, overflow: "hidden" },
  ccyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14 },
  ccyFlag: { fontSize: 18 },
  ccyCode: { fontSize: 14.5, lineHeight: 20 },
  ccyName: { flex: 1, fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },

  // The group label from the menu, set to the sheet's own gutter rather than
  // the scroll view's.
  ratesLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 6,
  },
  // A table: the token on the left, then a column each way. One line per
  // token, so four tokens read as four lines rather than eight figures.
  rateRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10 },
  rateHead: { paddingTop: 11, paddingBottom: 5 },
  rateNames: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  rateSym: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  rateUnit: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_400Regular" },
  // Wide enough for the longest figure the feed produces - SOL, six digits
  // and a separator - so the two columns stay aligned down the card.
  rateColHead: { width: 76, textAlign: "right", fontSize: 9.5, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.9 },
  rateFig: { width: 76, textAlign: "right", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  ratesFoot: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular", marginTop: 12, paddingHorizontal: 2 },
  valuePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  valueText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  footer: { alignItems: "center", marginTop: 34, gap: 10 },
  // Barely there: a watermark, not a second logo.
  footerMark: { width: 118, height: 20, opacity: 0.16 },
  version: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular" },

  container: { flex: 1 },



  /* Verified sheet */
  vsOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  vsSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  vsHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 22 },
  vsHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  vsMark: { width: 18, height: 18 },
  vsEyebrow: { fontSize: 10, lineHeight: 13, fontFamily: "Inter_700Bold", letterSpacing: 1.4 },
  vsTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1,
    marginTop: 14,
  },
  vsRule: { height: StyleSheet.hairlineWidth, marginTop: 22, marginBottom: 6 },
  // Label left, figure right, the way the limits screen sets them out.
  vsRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingVertical: 11 },
  vsRowK: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_400Regular" },
  vsRowV: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  vsFoot: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 12 },
  vsBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 22 },
  vsBtnText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },

  // A centred dialog, dimmed behind. The only one left on this screen: the
  // verified panel became a bottom sheet, which is where every other sheet in
  // the app comes from.
  dialogOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 32,
  },

  /* Logout modal */
  outCard: { borderRadius: 26, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 14 },
  outTitle: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.7 },
  outBody: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 8 },
  outStay: { height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 22 },
  outStayText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  outGo: { alignItems: "center", paddingVertical: 14, marginTop: 2 },
  outGoText: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
});
