// The shop page: products, a basket kept in this browser, and the webhooks our server received.
const ngn = (n) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let products = [];
let basket = {};
try {
  basket = JSON.parse(localStorage.getItem("koko-basket") || "{}");
} catch {
  basket = {};
}
const keep = () => {
  try {
    localStorage.setItem("koko-basket", JSON.stringify(basket));
  } catch {}
};

async function config() {
  const chip = $("mode");
  try {
    const c = await (await fetch("/api/config")).json();
    if (!c.configured) {
      chip.textContent = "Not connected";
      chip.className = "chip off";
    } else if (c.mode === "live") {
      chip.textContent = "Live payments";
      chip.className = "chip live";
    } else {
      chip.textContent = "Test payments";
      chip.className = "chip";
    }
  } catch {
    chip.textContent = "Offline";
    chip.className = "chip off";
  }
}

function renderProducts() {
  $("products").innerHTML = products
    .map(
      (p) => `
    <article class="product">
      <div class="pack" style="background:${esc(p.tone)}">
        <div class="label">KÒKÓ<small>${esc(p.note.split(" · ")[0])}</small></div>
      </div>
      <div class="body">
        <h3>${esc(p.name)}</h3>
        <div class="note">${esc(p.note)}</div>
        <div class="row">
          <span class="price">${ngn(p.price)}</span>
          <button class="btn" data-add="${esc(p.id)}">Add</button>
        </div>
      </div>
    </article>`,
    )
    .join("");
}

function renderBasket() {
  const lines = products.filter((p) => basket[p.id] > 0);
  $("basket").innerHTML = lines.length
    ? lines
        .map(
          (p) => `
      <div class="line">
        <span>${esc(p.name)}</span>
        <span class="qty">
          <button data-less="${esc(p.id)}" aria-label="One less">−</button>
          <span>${basket[p.id]}</span>
          <button data-add="${esc(p.id)}" aria-label="One more">+</button>
        </span>
      </div>`,
        )
        .join("")
    : `<div class="empty">Nothing in it yet.</div>`;
  const total = lines.reduce((s, p) => s + p.price * basket[p.id], 0);
  $("total").textContent = ngn(total);
  $("pay").disabled = !lines.length;
}

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]")?.dataset.add;
  const less = e.target.closest("[data-less]")?.dataset.less;
  if (add) basket[add] = Math.min(10, (basket[add] || 0) + 1);
  if (less) basket[less] = Math.max(0, (basket[less] || 0) - 1);
  if (add || less) {
    keep();
    renderBasket();
  }
});

$("pay").addEventListener("click", async () => {
  const btn = $("pay");
  const problem = $("problem");
  problem.hidden = true;
  btn.disabled = true;
  btn.textContent = "Opening checkout…";
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: Object.entries(basket).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty })),
        email: $("email").value.trim() || undefined,
        name: $("name").value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't start the payment.");
    basket = {};
    keep();
    // Off to the Money Moves checkout. It sends the customer back to /order/… when they've paid.
    window.location.assign(data.order.url);
  } catch (err) {
    problem.textContent = err.message;
    problem.hidden = false;
    btn.disabled = false;
    btn.textContent = "Pay with Money Moves";
  }
});

async function events() {
  try {
    const { events } = await (await fetch("/api/events")).json();
    if (!events.length) return;
    $("events").innerHTML = events
      .map(
        (e) => `
      <div class="event">
        <span class="ok">✓ signature checked</span> <span class="dim">${new Date(e.at).toLocaleTimeString()}</span><br>
        <b>${esc(e.type)}</b>${e.order ? ` <span class="dim">for</span> ${esc(e.order)}` : ""}${e.reference ? `<br><span class="dim">payment</span> ${esc(e.reference)}` : ""}
      </div>`,
      )
      .join("");
  } catch {}
}

(async () => {
  void config();
  try {
    products = (await (await fetch("/api/products")).json()).products;
  } catch {
    products = [];
  }
  renderProducts();
  renderBasket();
  void events();
  setInterval(events, 4000);
})();
