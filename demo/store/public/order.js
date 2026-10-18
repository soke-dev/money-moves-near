// One order: checks with our server every few seconds until it's paid.
const ngn = (n) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const id = location.pathname.split("/").pop();
const METHOD = { bank_transfer: "Bank transfer", app: "Money Moves app", crypto: "Crypto" };

function render(o) {
  $("number").textContent = `Order ${o.id}`;
  $("lines").innerHTML = o.items.length
    ? o.items.map((i) => `<div class="line"><span>${i.qty} × ${esc(i.name)}</span><span>${ngn(i.price * i.qty)}</span></div>`).join("")
    : "";
  $("total").textContent = ngn(o.total);

  const dot = $("dot");
  const facts = [];
  if (o.status === "paid" || o.status === "underpaid") {
    const p = o.payment || {};
    dot.className = "dot paid";
    dot.textContent = "✓";
    $("title").textContent = o.status === "paid" ? "Paid. Thank you!" : "Part paid";
    $("lead").textContent = o.status === "paid" ? "Your coffee is on its way. (It isn't: this is a demo.)" : "Less than the total arrived. We'll be in touch.";
    facts.push(["Payment", esc(p.reference)]);
    facts.push(["Paid with", `${METHOD[p.method] || esc(p.method)}${p.coin ? ` · ${esc(p.coin)} on ${esc(p.network)}` : ""}`]);
    facts.push(["Received", ngn(p.amount_ngn)]);
    facts.push([
      "Confirmed by",
      o.paid_by === "webhook" ? `<span class="badge">✓ Webhook, signature checked</span>` : "Reading the checkout from Money Moves",
    ]);
    $("actions").innerHTML = `${p.receipt_url ? `<a class="btn dark" href="${esc(p.receipt_url)}" target="_blank" rel="noopener">Your receipt</a>` : ""}<a class="btn" href="/">Back to the shop</a>`;
  } else if (o.status === "pending") {
    dot.className = "dot wait";
    dot.textContent = "";
    $("title").textContent = "Waiting for your payment";
    $("lead").textContent = "Pay on the Money Moves page. This updates the moment it lands.";
    $("actions").innerHTML = `<a class="btn dark" href="${esc(o.url)}">Go to payment</a><a class="btn" href="/">Back to the shop</a>`;
  } else {
    dot.className = "dot no";
    dot.textContent = "×";
    $("title").textContent = o.status === "expired" ? "This order expired" : "This order was cancelled";
    $("lead").textContent = "Nothing was paid. Start again from the shop.";
    $("actions").innerHTML = `<a class="btn dark" href="/">Back to the shop</a>`;
  }
  facts.push(["Mode", o.mode === "live" ? "Live" : "Test"]);
  $("facts").innerHTML = facts.map(([k, v]) => `<div class="fact"><span>${k}</span><span>${v}</span></div>`).join("");
  return o.status === "pending";
}

async function check() {
  try {
    const res = await fetch(`/api/orders/${id}`);
    if (!res.ok) {
      $("title").textContent = "We can't find that order";
      $("lead").textContent = "Check the link, or start again from the shop.";
      $("dot").className = "dot no";
      $("dot").textContent = "?";
      $("actions").innerHTML = `<a class="btn dark" href="/">Back to the shop</a>`;
      return;
    }
    const { order } = await res.json();
    if (render(order)) setTimeout(check, 3000);
  } catch {
    setTimeout(check, 5000);
  }
}
check();
