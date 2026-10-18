import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Widget, WidgetConfigProvider } from "@aurora-is-near/intents-swap-widget";
import "@aurora-is-near/intents-swap-widget/styles.css";

// Aurora API key for the embedded widget. Provided via env (VITE_AURORA_API_KEY)
// so it isn't committed to source. Set it in Netlify env + a local .env.
const AURORA_API_KEY = (import.meta.env as any).VITE_AURORA_API_KEY ?? "";

/**
 * Cross-chain deposit wrapper.
 *
 * Renders Aurora's Intents Swap Widget with the user's Movement wallet
 * address (`?address=0x…`) as the deposit destination, so anything they
 * send from any chain settles as USDCx directly into their wallet.
 *
 * The mobile app loads this page in a WebView; the web app links
 * directly to it. Both pass the user's address as a query parameter.
 */
export default function IntentsDeposit() {
  const [params] = useSearchParams();
  const rawAddress = params.get("address")?.trim() || "";
  const themeName = params.get("theme") === "light" ? "light" : "dark";

  // Light validation — the widget will reject malformed addresses anyway.
  const isValid = useMemo(() => /^0x[0-9a-fA-F]{4,}$/.test(rawAddress), [rawAddress]);

  if (!isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-3">Missing wallet address</h1>
          <p className="text-sm text-white/60">
            Open this page from the Money Moves app or pass{" "}
            <code className="bg-white/10 px-1.5 py-0.5 rounded">?address=&lt;your-movement-address&gt;</code>
            {" "}in the URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ backgroundColor: themeName === "light" ? "#ffffff" : "#0a0a0a" }}
    >
      <div className="w-full max-w-[440px] p-3">
        <WidgetConfigProvider
          config={{
            apiKey: AURORA_API_KEY,
            connectedWallets: {},
            slippageTolerance: 100,
            enableAccountAbstraction: true,
            enableAutoTokensSwitching: false,
            chainsOrder: [
              "btc",
              "tron",
              "eth",
              "sol",
              "base",
              "arb",
              "sui",
              "bsc",
              "pol",
              "doge",
              "ltc",
              "op",
              "ton",
              "monad",
              "movement" as any,
            ],
            allowedChainsList: [
              "btc",
              "tron",
              "eth",
              "sol",
              "base",
              "arb",
              "sui",
              "bsc",
              "pol",
              "doge",
              "ltc",
              "op",
              "ton",
              "monad",
              "movement" as any,
            ],
            allowedTokensList: [
              "BTC",
              "USDT",
              "USDC",
              "USDCx",
              "ETH",
              "SOL",
              "TRX",
              "DOGE",
              "LTC",
              "WBTC",
              "cbBTC",
              "BNB",
              "TON",
              "POL",
              "ARB",
              "NEAR",
              "USDT0",
            ],
            defaultSourceToken: {
              symbol: "USDT",
              blockchain: "tron",
            },
            defaultTargetToken: {
              symbol: "USDCx",
              blockchain: "movement" as any,
            },
            // The user's Movement wallet — every deposit lands here.
            sendAddress: rawAddress,
            showTransactionHistory: true,
            showConversionPreview: true,
            extraQuoteParameters: {},
          }}
          theme={{
            accentColor: "#C8F53C",
            successColor: "#98FFB5",
            warningColor: "#FADFAD",
            errorColor: "#FFB8BE",
            colorScheme: themeName,
            borderRadius: "md",
            stylePreset: "clean",
            backgroundColor: themeName === "light" ? "#ffffff" : "#16181D",
          }}
        >
          <Widget />
        </WidgetConfigProvider>
      </div>
    </div>
  );
}
