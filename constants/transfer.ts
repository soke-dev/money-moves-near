import { PixelRatio, StyleSheet } from "react-native";
import { isStellarAddress } from "@/services/stellar-address";

/* ─── Types ─── */
export type TokenSymbol = "USDC" | "USDT" | "USDCx" | "ETH" | "MOVE" | "SOL" | "cNGN";
export interface NetworkInfo { name: string; tag: string; }

/**
 * User-facing label for an asset symbol. Native USDC on Movement is stored
 * internally under the "USDCx" key (balances, on-chain, API), but is always
 * shown to users as plain "USDC". Use this anywhere an asset is rendered.
 */
export function assetLabel(asset: string): string {
  return asset === "USDCx" ? "USDC" : asset;
}

/**
 * On-chain asset key for a display token on a given chain. Native USDC on
 * Movement is held as the USDCx asset, so transactional screens (sell, send,
 * bills) treat "USDC on Movement" as USDCx. The legacy bridged USDC.e keeps
 * the plain "USDC" key and is only offered on the withdrawal screen.
 */
export function onChainAsset(token: string, chain: string): string {
  return token === "USDC" && chain === "MOVE" ? "USDCx" : token;
}

/**
 * Chain marks, keyed by chain tag.
 *
 * The same map is currently copied into components/TransactionItem,
 * components/TransactionProcessingOverlay and app/sell - this is the shared
 * one to migrate them onto.
 */
/**
 * What a balance can actually be sent, once the fee is accounted for.
 *
 * Only Arc differs. Everywhere else gas is a separate asset the treasury
 * sponsors, so the whole balance is spendable. On Arc the fee is paid in the
 * same USDC being sent and nobody sponsors it, so sending the entire balance
 * leaves nothing to pay with and the transfer fails for want of a fraction of
 * a cent.
 *
 * Held back quietly rather than shown as a line item. "We kept 0.0019 for gas"
 * is a sentence nobody needs; a maximum that simply works is the same
 * information without the arithmetic lesson.
 *
 * The reserve is generous against a fee quoted under a cent - what is left
 * over stays theirs and goes out with the next send.
 */
export const ARC_GAS_RESERVE = 0.01;

/**
 * The same idea on TON, for a different reason.
 *
 * Nobody sponsors gas there either, but rather than the chain's own currency
 * the fee is taken by a relay, in the USDT being sent, out of the very same
 * signed request. Send the whole balance and there is nothing left for the
 * relay to take, so the transfer fails.
 *
 * Measured commission is a flat 0.006 USDT whatever the size. This is
 * generous against that because the figure is TON gas priced in USDT and
 * moves with the TON price; the remainder stays theirs and goes out with the
 * next send. Mirrors TON_FEE_RESERVE in backend/src/lib/ton.ts.
 */
export const TON_FEE_RESERVE = 0.02;

export function spendableBalance(chain: string, balance: number): number {
  const reserve =
    chain === "ARC" ? ARC_GAS_RESERVE : chain === "TON" ? TON_FEE_RESERVE : 0;
  if (!reserve) return balance;
  const left = balance - reserve;
  // Floor to the stored precision so the figure offered can never round up
  // past what the chain will actually let go.
  return left > 0 ? Math.floor(left * 1e8) / 1e8 : 0;
}

/**
 * The least you may send, per token.
 *
 * Mirrors MIN_WITHDRAW in backend/src/routes/transactions.ts. Kept here so
 * the pickers can hide a holding too small to send rather than offer it and
 * have the server refuse it.
 */
export const MIN_WITHDRAW: Record<string, number> = {
  USDC: 0.20, USDCe: 0.20, USDT: 0.20, USDCx: 0.20, MOVE: 0.10, SOL: 0.001,
  // Counted in naira, not dollars: 100 cNGN is about 99 naira, the same order
  // as the 0.20 USDC above rather than the 0.20 cNGN a copied figure gives.
  cNGN: 100,
};

/** The same floor for a send to another Money Moves user, which is lower. */
export const MIN_SEND: Record<string, number> = {
  USDC: 0.10, USDT: 0.10, USDCx: 0.10, MOVE: 0.05, SOL: 0.001,
  cNGN: 50,
};

/**
 * Is this holding big enough to actually send?
 *
 * Not the same question as "is it more than zero". A chain holding a
 * thousandth of a cent has a balance, prints as 0.0000 at the precision these
 * screens use, and cannot be sent anywhere - so offering it is a row that
 * looks like an option and is really a dead end. BNB Smart Chain sat in the
 * network sheet showing 0.0000 for exactly this reason.
 *
 * Asked of the SPENDABLE balance, so a chain that pays its own fee is judged
 * on what would survive the fee: two cents of USDT on TON is not sendable
 * when a hundredth is held back for the relay and the floor is a tenth.
 */
export function isSendable(chain: string, balance: number, minimum: number): boolean {
  return spendableBalance(chain, balance) >= minimum;
}

export const CHAIN_MARKS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  SOL: require("@/assets/images/solana.png"),
  BASE: require("@/assets/images/base logo.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARB: require("@/assets/images/arbitrumlogo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
};

/**
 * Sell fees, mirroring SELL_FEE_RATE and SELL_PROCESSING_FEE in
 * backend/src/routes/transactions.ts.
 *
 * The server returns the two added together, so every screen that wants to
 * name them separately subtracts the flat part back out - which only works
 * while these agree with the backend. One definition here rather than a copy
 * per screen.
 */
export const SELL_FEE_RATE = 0.005;
export const SELL_PROCESSING_FEE = 50;

/** Split a total sell fee into its named parts. */
export function splitSellFee(total: number): { platform: number; processing: number } {
  if (!total || total <= 0) return { platform: 0, processing: 0 };
  const processing = Math.min(SELL_PROCESSING_FEE, total);
  return { platform: Math.max(0, total - processing), processing };
}

/* ─── Data ─── */
export const NIGERIAN_BANKS = [
  "9 Payment Solutions Bank", "Access Bank", "Carbon", "Citibank",
  "Coronation Bank", "Ecobank", "Fairmoney Microfinance Bank",
  "Fidelity Bank", "First Bank of Nigeria", "First City Monument Bank",
  // Formerly OK MFB. Code 090567 on both providers.
  "Flutterwave MFB",
  // Heritage was liquidated by the NDIC in 2024 and Flutterwave does not
  // list it, so a payout to it can never be sent. Offering it only ends in a
  // resolve that fails and a person wondering what they typed wrong.
  "Globus Bank", "Guaranty Trust Bank", "Jaiz Bank",
  "Keystone Bank", "Kuda Bank", "Lotus Bank", "Moniepoint",
  "Momo PSB",
  // Nombank MFB to both providers, under the name people know it by. Mapped
  // by code on each rail: "nomba" is a substring of two different Flutterwave
  // institutions, so the name alone could pay the wrong one.
  "Nomba",
  "Opay", "Palmpay",
  // Paystack's Titan accounts. Code 100039 on both providers; not the same
  // institution as Titan Trust Bank, which is listed separately.
  "Paystack-Titan",
  "Polaris Bank", "Premium Trust Bank",
  "Providus Bank", "Rubies Microfinance Bank",
  // Airtel's payment service bank. Flutterwave calls it this; Paystack calls
  // it "Airtel Smartcash PSB" and neither name contains the other, so the
  // Paystack rail needs the alias in PS_NAME_ALIASES to find it. Both land on
  // the same NIBSS code, 120004.
  "Smartcash Payment Service Bank", "Sparkle",
  "Stanbic IBTC Bank", "Standard Chartered", "Sterling Bank",
  "SunTrust Bank", "TAJBank", "Titan Trust Bank", "Union Bank",
  "United Bank for Africa", "Unity Bank", "VFD Microfinance Bank",
  "Wema Bank", "Zenith Bank",
];

/**
 * Artwork we ship ourselves, for banks the logo CDN does not carry.
 *
 * Bundled rather than fetched, so it is one require rather than a round trip
 * that can fail - and these exist precisely because the CDN has no answer for
 * them, so there is nothing to fall back to.
 */
export const BANK_LOGO_ASSETS: Record<string, number> = {
  "Smartcash Payment Service Bank": require("@/assets/images/smartcash.png"),
  "Nomba": require("@/assets/images/nomba logo.png"),
  "Paystack-Titan": require("@/assets/images/paystack tittan.png"),
  "Flutterwave MFB": require("@/assets/images/flutterwave MFB.png"),
};

/**
 * What to hand an <Image source>, whichever kind of artwork a bank has.
 *
 * A remote logo is a `{ uri }` and a bundled one is a module id, and callers
 * were writing `{ uri: BANK_LOGOS[name] }` by hand - which silently produces
 * `{ uri: undefined }` for a bundled asset and draws nothing. Asking here means
 * a bank gains a local logo without four screens having to learn about it.
 */
export function bankLogoSource(bank?: string | null): { uri: string } | number | null {
  if (!bank) return null;
  const local = BANK_LOGO_ASSETS[bank];
  if (local) return local;
  const url = BANK_LOGOS[bank];
  return url ? { uri: url } : null;
}

/** Bank logo URLs from Nigeria-Banks-Logo-API (Cloudinary CDN) */
export const BANK_LOGOS: Record<string, string> = {
  "9 Payment Solutions Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835326/9Payment_Service_Bank_nxm5ij.png",
  "Access Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835318/access-bank_u0pg90.png",
  "Carbon": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835272/Carbon_olhrz6.png",
  "Citibank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835252/Citibank_Nigeria_cjd5ma.png",
  "Coronation Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731834972/Coronation_Merchant_Bank_vnoj5c.png",
  "Ecobank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835234/Ecobank_Nigeria_qdd70j.png",
  "Fairmoney Microfinance Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731834992/Fairmoney_Microfinance_Bank_idowum.png",
  "Fidelity Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835222/Fidelity_Bank_lkl2mr.png",
  "First Bank of Nigeria": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835216/First_Bank_of_Nigeria_drawyb.png",
  "First City Monument Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835213/First_City_Monument_Bank_aeufbo.png",
  "Globus Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731834952/Globus_Bank_d1oapw.png",
  "Guaranty Trust Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731834954/Guaranty_Trust_Bank_odgbdu.png",
  "Jaiz Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835113/Jaiz_Bank_fambas.png",
  "Keystone Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835110/Keystone-Bank_cvicmd.png",
  "Kuda Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835102/Kuda_Bank_f5nrij.png",
  "Lotus Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731835025/Lotus_Bank_ykfh6u.png",
  "Moniepoint": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731907889/Moniepoint_MFB_hxoelg.png",
  "Momo PSB": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731907895/MTN_Momo_PSB_rorvc4.png",
  "Opay": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731910673/OPay_Digital_Services_Limited__OPay_zyh5d0.png",
  "Palmpay": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731910656/PalmPay_lzs7yt.png",
  "Polaris Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731907984/Polaris_Bank_irqlkv.png",
  "Premium Trust Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731907996/PremiumTrust_Bank_zsds6j.png",
  "Providus Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908004/Providus_Bank_oo0ue2.png",
  "Rubies Microfinance Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908045/Rubies_MFB_gx6frx.png",
  "Sparkle": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908074/Sparkle_Microfinance_Bank_vgopsi.png",
  "Stanbic IBTC Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908079/Stanbic_IBTC_Bank_qjczcl.png",
  "Standard Chartered": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908084/Standard_Chartered_Bank_vrrfp5.png",
  "Sterling Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908098/Sterling_Bank_ooipqt.png",
  "SunTrust Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908103/Suntrust_Bank_wnlowk.png",
  "TAJBank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908109/TAJ_Bank_gyek38.png",
  "Union Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908157/Union_Bank_of_Nigeria_i8mtrj.png",
  "United Bank for Africa": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908162/United_Bank_For_Africa_om7axi.png",
  "Unity Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908167/Unity_Bank_uprqwi.png",
  "VFD Microfinance Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908181/VFD_Microfinance_Bank_Limited_npn5fv.png",
  "Wema Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908191/Wema_Bank_cr2pvu.png",
  "Zenith Bank": "https://res.cloudinary.com/dweovytuc/image/upload/f_auto,q_auto/v1731908201/Zenith_Bank_h40m09.png",
};

/**
 * A token amount, without the zeros it does not need.
 *
 * Padding to four places made a round number look like a measurement: two
 * USDC read as "2.0000 USDC", four digits of precision claiming to mean
 * something when three of them are noise. The places are a ceiling now, not a
 * quota - 2 stays 2, 2.5 stays 2.5, and 0.12345678 still gets the room it
 * actually needs.
 */
export function fmtAsset(amount: number | string, asset?: string): string {
  const n = Number(amount) || 0;
  const places = asset === "ETH" ? 8 : 4;
  return String(Number(n.toFixed(places)));
}

export const BANK_FEE_RATE = 0.005;
export const CRYPTO_FEE_RATE = 0.001;
export const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 20000];

/**
 * The chains each token can move on, in the order they are offered.
 *
 * Order is the default as well as the list: the first entry is what a deposit
 * opens on, so it runs from the chain we settle on to the ones people are most
 * likely to be sending from.
 */
export const TOKEN_NETWORKS: Record<TokenSymbol, NetworkInfo[]> = {
  USDC: [
    { name: "Movement", tag: "MOVE" },
    // Under Movement deliberately: Arc is where USDC is the chain's own
    // currency rather than a token on it, so it is the other first-class home
    // for USDC and belongs beside Movement rather than after the also-rans.
    { name: "Arc", tag: "ARC" },
    { name: "Solana", tag: "SOL" },
    { name: "BNB Smart Chain", tag: "BEP20" },
    // Opened on first use: picking it is what creates the account and the
    // trustline. Never on-ramp - buy.tsx filters it out.
    { name: "Stellar", tag: "STELLAR" },
    // EVM, the same address as Base. Off-ramp, bills and transfers only;
    // buy.tsx filters it out.
    { name: "Monad", tag: "MONAD" },
    { name: "Base", tag: "BASE" },
  ],
  USDT: [
    { name: "Movement", tag: "MOVE" },
    { name: "Solana", tag: "SOL" },
    { name: "BNB Smart Chain", tag: "BEP20" },
    { name: "TON", tag: "TON" },
    // USDT0, Tether's own USDT on Stellar.
    { name: "Stellar", tag: "STELLAR" },
    // USDT0 again - Tether's USDT on Monad.
    { name: "Monad", tag: "MONAD" },
    { name: "Base", tag: "BASE" },
  ],
  USDCx: [
    { name: "Movement", tag: "MOVE" },
  ],
  ETH: [
    { name: "Base", tag: "BASE" },
    { name: "Arbitrum", tag: "ARB" },
  ],
  MOVE: [
    { name: "Movement", tag: "MOVE" },
  ],
  SOL: [
    { name: "Solana", tag: "SOL" },
  ],
  // A naira stablecoin, issued on these two only.
  cNGN: [
    { name: "Base", tag: "BASE" },
    { name: "BNB Smart Chain", tag: "BEP20" },
  ],
};

export const TOKENS: TokenSymbol[] = ["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"];

/**
 * The reader's own font-size setting, as a multiplier.
 *
 * Text obeys it and Image does not, and the naira mark is an Image sitting
 * beside a figure - drawn as a glyph because the system font renders a
 * crossbar through the letter at these sizes. So every box was tuned against
 * a figure at scale 1: turn the setting down and the mark stays put while the
 * figure shrinks under it, which is how a naira sign ends up taller than the
 * amount it belongs to. Turn it up and the mark is left behind.
 *
 * Multiply the box by this and the two move together. Read once at load, the
 * way StyleSheet.create is - which means an iOS reader who changes Dynamic
 * Type without relaunching sees the old box until they do.
 */
export const FONT_SCALE = PixelRatio.getFontScale();

/* ─── Helpers ─── */
export const fmtNaira = (n: number) =>
  "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Is this a real TON address?
 *
 * Worth more than a regex here. A TON address is written either raw
 * (`0:<64 hex>`) or in the friendly base64 form that begins EQ or UQ, and the
 * friendly form carries a two-byte checksum over the rest of it. Checking
 * that catches a mistyped or truncated address, which on this chain is a
 * transfer into nowhere.
 *
 * Implemented here rather than with @ton/core on purpose: that library would
 * be a new dependency in the app bundle for one comparison the server does
 * properly anyway, and the last new dependency in this bundle nearly took the
 * app down. The server re-checks with the real parser before anything moves.
 */
export function isTonAddress(value: string): boolean {
  const a = (value || "").trim();
  if (!a) return false;

  // Raw form: workchain, a colon, and the 32-byte account id in hex.
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(a)) return true;

  // Friendly form: 36 bytes of base64 (url-safe or not), so 48 characters.
  if (!/^[A-Za-z0-9_+/-]{48}$/.test(a)) return false;

  let bytes: number[];
  try {
    const b64 = a.replace(/-/g, "+").replace(/_/g, "/");
    const bin = globalThis.atob
      ? globalThis.atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
    bytes = Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (bytes.length !== 36) return false;

  // CRC16/XMODEM over the first 34 bytes, big-endian in the last two.
  let crc = 0;
  for (const byte of bytes.slice(0, 34)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return bytes[34] === (crc >> 8) && bytes[35] === (crc & 0xff);
}

/**
 * Validate wallet address format per chain.
 * - EVM (BASE, BEP20, ARB, ARC, MONAD): 0x + 40 hex chars (42 total)
 * - Solana (SOL): Base58 string, 32-44 chars, no 0/O/I/l
 * - Movement (MOVE): 0x + 64 hex chars (66 total)
 */
export function validateWalletAddress(address: string, chain: string): { valid: boolean; error?: string } {
  if (!address || address.trim().length === 0) {
    return { valid: false, error: "Wallet address is required" };
  }
  const a = address.trim();
  switch (chain) {
    case "BASE":
    case "BEP20":
    case "ARB":
    case "ARC":
    case "MONAD": {
      const evmRegex = /^0x[0-9a-fA-F]{40}$/;
      if (!evmRegex.test(a)) return { valid: false, error: "Invalid EVM address, must be 0x followed by 40 hex characters" };
      return { valid: true };
    }
    case "SOL": {
      const solRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      if (!solRegex.test(a)) return { valid: false, error: "Invalid Solana address, must be 32-44 base58 characters" };
      return { valid: true };
    }
    case "MOVE": {
      const moveRegex = /^0x[0-9a-fA-F]{64}$/;
      if (!moveRegex.test(a)) return { valid: false, error: "Invalid Movement address, must be 0x followed by 64 hex characters" };
      return { valid: true };
    }
    case "TON": {
      if (!isTonAddress(a)) {
        return { valid: false, error: "Invalid TON address" };
      }
      return { valid: true };
    }
    case "STELLAR": {
      // Checksum verified, so a typo is caught here rather than sent nowhere.
      if (!isStellarAddress(a)) {
        return { valid: false, error: "Invalid Stellar address, must start with G and be 56 characters" };
      }
      return { valid: true };
    }
    default:
      return { valid: false, error: "Unknown network" };
  }
}

/**
 * The address inside whatever a QR code actually contained.
 *
 * Most wallets encode the bare address, but plenty wrap it in a payment URI,
 * and the schemes disagree about where the address goes:
 *
 *   ethereum:0xabc…@1/transfer?value=1   <- address FIRST  (EIP-681)
 *   ton://transfer/UQAbc…?amount=1       <- address LAST
 *   solana:5xyz…?amount=1                <- address first, no //
 *
 * This used to be `data.split(":").pop()`, which reads the ethereum form
 * correctly and turns the TON one into "//transfer/UQAbc…" - a string that
 * goes in the address box and fails validation with no hint why.
 *
 * So rather than teach it every layout, split on every separator a URI uses
 * and take whichever piece is a real address for the chain being sent on.
 * The chain has already been chosen by the time anyone opens the scanner, so
 * this is a precise test rather than a guess.
 *
 * Whatever was scanned comes back unchanged if nothing validates: showing the
 * person what the code actually said beats quietly handing them a mangled
 * version of it.
 */
export function addressFromScan(data: string, chain: string): string {
  const raw = (data || "").trim();
  if (!raw) return "";
  if (validateWalletAddress(raw, chain).valid) return raw;
  for (const piece of raw.split(/[:/?&=@#]+/)) {
    if (piece && validateWalletAddress(piece, chain).valid) return piece;
  }
  return raw;
}

/* ─── Shared styles ─── */
export const ts = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },

  /* Form */
  formCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 8, marginTop: 16 },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  fieldPlaceholder: { fontSize: 15, fontFamily: "Inter_400Regular" },
  fieldValue: { fontSize: 15, fontFamily: "Inter_500Medium" },
  fieldInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", height: "100%" },
  bankSelectedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bankDot: { width: 28, height: 28, borderRadius: 14 },
  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  verifiedName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Beneficiaries */
  benSection: { paddingHorizontal: 20, marginTop: 24 },
  benHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  benTabs: { flexDirection: "row", gap: 20 },
  benTabText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  viewAllText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  benRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  benDot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  benName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  benMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Amount */
  recipientCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  recipientBank: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recipientName: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  amountLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  amountLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  balanceLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
  },
  nairaPrefix: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginRight: 6 },
  amountInput: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", height: "100%" },
  tokenSuffix: { fontSize: 14, fontFamily: "Inter_500Medium", marginLeft: 8 },
  insufficientText: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 6 },
  feeHintText: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 6 },
  maxBtn: { fontSize: 12, fontFamily: "Inter_700Bold" },
  // flexGrow:0: a horizontal scroller in a column stretches otherwise.
  chipsRow: { flexGrow: 0, marginTop: 12, marginBottom: 20 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  narrationLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10 },
  narrationWrap: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
  },
  narrationInput: { fontSize: 14, fontFamily: "Inter_400Regular", textAlignVertical: "top" },

  /* Token select */
  sectionHint: { fontSize: 14, fontFamily: "Inter_500Medium", paddingHorizontal: 20, marginTop: 8, marginBottom: 12 },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  tokenName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  tokenBal: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Warning */
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 20,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  /* Summary */
  breakdownCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  breakdownLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  breakdownValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  breakdownDivider: { height: StyleSheet.hairlineWidth },
  breakdownLabelBold: { fontSize: 15, fontFamily: "Inter_700Bold" },
  breakdownValueBold: { fontSize: 15, fontFamily: "Inter_700Bold" },
  bankDetailsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 16,
  },
  bankDetailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bankDetailLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  bankDetailValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  saveBenRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 24,
  },
  saveBenText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* PIN modal */
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  pinSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#666",
    marginBottom: 20,
  },
  pinIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  pinHeading: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 6 },
  pinSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 24 },
  pinRow: { flexDirection: "row", gap: 14, marginBottom: 16 },
  pinBox: {
    width: 52,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },

  /* Bank modal */
  bankSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  bankSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  bankSheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  bankSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 10,
  },
  bankSearchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", height: "100%" },
  bankItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bankItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  bankItemText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  networkOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
});
