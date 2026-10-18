/**
 * Kòkó Coffee, the app: buys from the demo shop and pays with Money Moves.
 *
 * The app never holds a Money Moves key. It asks the shop's server for an
 * order; the server makes the checkout with its secret key and gives back the
 * checkout's address. The app opens it in the browser, and when the customer
 * comes back, asks the shop whether the order is paid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";

const STORE = String(process.env.EXPO_PUBLIC_STORE_URL ?? Constants.expoConfig?.extra?.storeUrl ?? "").replace(/\/+$/, "");

type Product = { id: string; name: string; note: string; price: number; tone: string };
type Order = {
  id: string;
  status: "pending" | "paid" | "underpaid" | "expired" | "cancelled";
  items: { id: string; name: string; qty: number; price: number }[];
  total: number;
  url: string;
  mode: "test" | "live";
  payment: { reference: string; method: string; amount_ngn: number; receipt_url: string | null; coin: string | null; network: string | null } | null;
  paid_by: "webhook" | "api" | null;
};

const ngn = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", app: "Money Moves app", crypto: "Crypto" };

async function shop<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${STORE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "The shop didn't answer. Try again.");
  return body as T;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
        <Main />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Main() {
  const [orderId, setOrderId] = useState<string | null>(null);
  return orderId ? <OrderScreen id={orderId} onDone={() => setOrderId(null)} /> : <ShopScreen onOrder={setOrderId} />;
}

function ShopScreen({ onOrder }: { onOrder: (id: string) => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!STORE || STORE.includes("PLACEHOLDER")) {
      setProblem("Set the shop's address in app.json (extra.storeUrl) or EXPO_PUBLIC_STORE_URL.");
      setProducts([]);
      return;
    }
    shop<{ products: Product[] }>("/api/products")
      .then((r) => setProducts(r.products))
      .catch((e: Error) => {
        setProblem(e.message);
        setProducts([]);
      });
    shop<{ mode: string | null; configured: boolean }>("/api/config")
      .then((c) => setMode(c.configured ? c.mode : null))
      .catch(() => setMode(null));
  }, []);

  const change = (id: string, by: number) => setBasket((b) => ({ ...b, [id]: Math.max(0, Math.min(10, (b[id] ?? 0) + by)) }));
  const lines = (products ?? []).filter((p) => (basket[p.id] ?? 0) > 0);
  const total = lines.reduce((sum, p) => sum + p.price * (basket[p.id] ?? 0), 0);

  const pay = async () => {
    setBusy(true);
    setProblem("");
    try {
      const { order } = await shop<{ order: Order }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({ items: lines.map((p) => ({ id: p.id, qty: basket[p.id] })), email: email.trim() || undefined }),
      });
      setBasket({});
      // The Money Moves checkout, in the browser. When it closes, the order screen asks the shop what happened.
      await WebBrowser.openBrowserAsync(order.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      onOrder(order.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't start the payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Text style={s.brand}>Kòkó Coffee</Text>
        {mode && <Text style={[s.chip, mode === "live" && s.chipLive]}>{mode === "live" ? "Live payments" : "Test payments"}</Text>}
      </View>
      <ScrollView contentContainerStyle={s.list}>
        <Text style={s.title}>Fresh coffee, paid any way you like.</Text>
        <Text style={s.lead}>Bank transfer, the Money Moves app, or USDC and USDT.</Text>
        {products === null && <ActivityIndicator style={{ marginTop: 30 }} color="#1d1915" />}
        {(products ?? []).map((p) => (
          <View key={p.id} style={s.card}>
            <View style={[s.swatch, { backgroundColor: p.tone }]}>
              <Text style={s.swatchText}>KÒKÓ</Text>
            </View>
            <View style={s.cardBody}>
              <Text style={s.name}>{p.name}</Text>
              <Text style={s.note}>{p.note}</Text>
              <View style={s.row}>
                <Text style={s.price}>{ngn(p.price)}</Text>
                <View style={s.qty}>
                  {(basket[p.id] ?? 0) > 0 && (
                    <>
                      <Pressable style={s.qtyBtn} onPress={() => change(p.id, -1)} accessibilityLabel={`One less ${p.name}`}>
                        <Text style={s.qtyText}>−</Text>
                      </Pressable>
                      <Text style={s.qtyCount}>{basket[p.id]}</Text>
                    </>
                  )}
                  <Pressable style={s.qtyBtn} onPress={() => change(p.id, 1)} accessibilityLabel={`One more ${p.name}`}>
                    <Text style={s.qtyText}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ))}
        {!!problem && <Text style={s.problem}>{problem}</Text>}
      </ScrollView>
      <View style={s.bar}>
        <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Email for your receipt (optional)" placeholderTextColor="#9a9186" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Pressable style={[s.payBtn, (!lines.length || busy) && s.payOff]} disabled={!lines.length || busy} onPress={() => void pay()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.payText}>{lines.length ? `Pay ${ngn(total)} with Money Moves` : "Add something to pay"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function OrderScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [problem, setProblem] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      const { order } = await shop<{ order: Order }>(`/api/orders/${id}`);
      setOrder(order);
      setProblem("");
      if (order.status === "pending") timer.current = setTimeout(() => void check(), 3000);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't reach the shop.");
      timer.current = setTimeout(() => void check(), 5000);
    }
  }, [id]);

  useEffect(() => {
    void check();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [check]);

  const paid = order?.status === "paid" || order?.status === "underpaid";
  const p = order?.payment;

  return (
    <ScrollView contentContainerStyle={s.orderWrap}>
      <View style={s.statusRow}>
        <View style={[s.dot, paid ? s.dotPaid : order && order.status !== "pending" ? s.dotNo : s.dotWait]}>
          {paid ? <Text style={s.dotText}>✓</Text> : order && order.status !== "pending" ? <Text style={s.dotTextDim}>×</Text> : <ActivityIndicator color="#1d1915" />}
        </View>
        <View style={s.fill}>
          <Text style={s.statusTitle}>{!order ? "Checking…" : paid ? (order.status === "paid" ? "Paid. Thank you!" : "Part paid") : order.status === "pending" ? "Waiting for your payment" : order.status === "expired" ? "This order expired" : "This order was cancelled"}</Text>
          <Text style={s.lead}>{paid ? "Your coffee is on its way. (It isn't: this is a demo.)" : order?.status === "pending" ? "This updates the moment it lands." : ""}</Text>
        </View>
      </View>

      {order && (
        <View style={s.panel}>
          <Text style={s.panelTitle}>Order {order.id}</Text>
          {order.items.map((i) => (
            <View key={i.id} style={s.line}>
              <Text style={s.lineText}>
                {i.qty} × {i.name}
              </Text>
              <Text style={s.lineText}>{ngn(i.price * i.qty)}</Text>
            </View>
          ))}
          <View style={[s.line, s.totalLine]}>
            <Text style={s.totalText}>Total</Text>
            <Text style={s.totalText}>{ngn(order.total)}</Text>
          </View>
          {paid && p && (
            <>
              <Fact k="Payment" v={p.reference} />
              <Fact k="Paid with" v={`${METHOD[p.method] ?? p.method}${p.coin ? ` · ${p.coin} on ${p.network}` : ""}`} />
              <Fact k="Received" v={ngn(p.amount_ngn)} />
              <Fact k="Confirmed by" v={order.paid_by === "webhook" ? "Webhook, signature checked" : "Reading the checkout"} />
            </>
          )}
          <Fact k="Mode" v={order.mode === "live" ? "Live" : "Test"} />
        </View>
      )}
      {!!problem && <Text style={s.problem}>{problem}</Text>}

      <View style={s.actions}>
        {order?.status === "pending" && (
          <Pressable style={s.payBtn} onPress={() => void WebBrowser.openBrowserAsync(order.url).then(() => void check())}>
            <Text style={s.payText}>Go to payment</Text>
          </Pressable>
        )}
        {paid && p?.receipt_url && (
          <Pressable style={s.payBtn} onPress={() => void WebBrowser.openBrowserAsync(p.receipt_url!)}>
            <Text style={s.payText}>Your receipt</Text>
          </Pressable>
        )}
        <Pressable style={s.ghostBtn} onPress={onDone}>
          <Text style={s.ghostText}>Back to the shop</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factKey}>{k}</Text>
      <Text style={s.factValue}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f2ea" },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#e6dfd2" },
  brand: { fontSize: 21, fontWeight: "700", letterSpacing: -0.6, color: "#1d1915" },
  chip: { fontSize: 12, fontWeight: "600", color: "#7a4e07", backgroundColor: "#fbefd7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  chipLive: { color: "#2f7a3e", backgroundColor: "#e4f2e8" },
  list: { padding: 20, paddingBottom: 30, gap: 14 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -1, color: "#1d1915", lineHeight: 34 },
  lead: { fontSize: 14.5, color: "#6e665c", lineHeight: 21, marginTop: 2 },
  card: { flexDirection: "row", backgroundColor: "#fffdf9", borderRadius: 18, borderWidth: 1, borderColor: "#e6dfd2", overflow: "hidden" },
  swatch: { width: 92, alignItems: "center", justifyContent: "flex-end", paddingBottom: 12 },
  swatchText: { fontSize: 11, fontWeight: "700", color: "#1d1915", backgroundColor: "rgba(255,253,249,0.94)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  cardBody: { flex: 1, padding: 14, gap: 3 },
  name: { fontSize: 16, fontWeight: "700", color: "#1d1915" },
  note: { fontSize: 13, color: "#6e665c" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  price: { fontSize: 16.5, fontWeight: "700", color: "#1d1915" },
  qty: { flexDirection: "row", alignItems: "center", gap: 10 },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#e6dfd2", alignItems: "center", justifyContent: "center", backgroundColor: "#fffdf9" },
  qtyText: { fontSize: 17, color: "#1d1915" },
  qtyCount: { fontSize: 15, fontWeight: "600", minWidth: 14, textAlign: "center", color: "#1d1915" },
  bar: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: "#e6dfd2", backgroundColor: "#f6f2ea" },
  input: { borderWidth: 1, borderColor: "#e6dfd2", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14.5, backgroundColor: "#fff", color: "#1d1915" },
  payBtn: { backgroundColor: "#1d1915", borderRadius: 999, paddingVertical: 15, alignItems: "center" },
  payOff: { opacity: 0.4 },
  payText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  ghostBtn: { borderRadius: 999, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: "#e6dfd2", backgroundColor: "#fffdf9" },
  ghostText: { color: "#1d1915", fontSize: 15, fontWeight: "600" },
  problem: { color: "#b8322a", fontSize: 13.5, marginTop: 6 },
  orderWrap: { padding: 20, paddingTop: 34, gap: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  dot: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  dotWait: { borderWidth: 1, borderColor: "#e6dfd2", backgroundColor: "#fffdf9" },
  dotPaid: { backgroundColor: "#2f7a3e" },
  dotNo: { backgroundColor: "#efe9de" },
  dotText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  dotTextDim: { color: "#6e665c", fontSize: 22 },
  statusTitle: { fontSize: 25, fontWeight: "700", letterSpacing: -0.8, color: "#1d1915" },
  panel: { backgroundColor: "#fffdf9", borderRadius: 18, borderWidth: 1, borderColor: "#e6dfd2", padding: 16 },
  panelTitle: { fontSize: 15.5, fontWeight: "700", color: "#1d1915", marginBottom: 6 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  lineText: { fontSize: 14, color: "#1d1915" },
  totalLine: { borderTopWidth: 1, borderTopColor: "#e6dfd2", marginTop: 4, paddingTop: 12 },
  totalText: { fontSize: 16, fontWeight: "700", color: "#1d1915" },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#efe9de" },
  factKey: { fontSize: 14, color: "#6e665c" },
  factValue: { fontSize: 14, color: "#1d1915", flexShrink: 1, textAlign: "right" },
  actions: { gap: 10 },
});
