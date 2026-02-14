const emailEl = document.getElementById("email");
const statusEl = document.getElementById("status");

function getCart(){
  try { return JSON.parse(localStorage.getItem("cart") || "[]"); } catch { return []; }
}

function setStatus(msg){ statusEl.textContent = msg || ""; }

async function startStripe(){
  const cart = getCart();
  if (!cart.length) return setStatus("Carrinho vazio.");

  const email = (emailEl.value || "").trim();
  if (!email) return setStatus("Coloca um email.");

  setStatus("A abrir pagamento (Stripe)...");
  const res = await fetch("/api/create-checkout-session", {
  method:"POST",
  headers:{ "Content-Type":"application/json" },
  body: JSON.stringify({ email, cart })
});

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return setStatus("❌ " + (data.error || "Erro"));
  window.location.href = data.url;
}

async function startPayPal(){
  const cart = getCart();
  if (!cart.length) return setStatus("Carrinho vazio.");

  const email = (emailEl.value || "").trim();
  if (!email) return setStatus("Coloca um email.");

  setStatus("A abrir pagamento (PayPal)...");
  const res = await fetch("/api/paypal-create-order", {
  method:"POST",
  headers:{ "Content-Type":"application/json" },
  body: JSON.stringify({ email, cart })
});

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return setStatus("❌ " + (data.error || "Erro PayPal"));

  const url = data.approval_url || data.approvalUrl;
if (!url) return setStatus("❌ Link de aprovação PayPal não encontrado.");
window.location.href = url;
}

document.getElementById("payStripe").addEventListener("click", startStripe);
document.getElementById("payPayPal").addEventListener("click", startPayPal);
