const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { userId, email, cart } = body;

    if (!userId || !email || !Array.isArray(cart) || cart.length === 0) {
      return json(400, { error: "Dados inválidos." });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const total = cart.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 1), 0);

    // criar order pending
    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert({
        user_id: userId,
        email,
        status: "pending",
        currency: "EUR",
        total,
        payment_provider: "paypal"
      })
      .select("*")
      .single();
    if (e1) return json(500, { error: e1.message });

    const items = cart.map((it) => ({
      order_id: order.id,
      product_id: it.id,
      name: it.name,
      price: it.price,
      qty: it.qty
    }));
    const { error: e2 } = await sb.from("order_items").insert(items);
    if (e2) return json(500, { error: e2.message });

    // PayPal token
    const token = await paypalToken();

    // criar order PayPal
    const res = await fetch(`${process.env.PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: order.id,
            amount: {
              currency_code: "EUR",
              value: total.toFixed(2)
            }
          }
        ],
        application_context: {
          return_url: `${process.env.SITE_URL}/success.html`,
          cancel_url: `${process.env.SITE_URL}/cancel.html`
        }
      })
    });

    const data = await res.json();
    if (!res.ok) return json(500, { error: data?.message || "Erro PayPal" });

    // guardar paypal_order_id
    await sb.from("orders").update({ paypal_order_id: data.id }).eq("id", order.id);

    const approval = (data.links || []).find(l => l.rel === "approve")?.href;
    return json(200, { approvalUrl: approval, paypalOrderId: data.id, orderId: order.id });
  } catch (err) {
    return json(500, { error: err.message || "Erro" });
  }
};

async function paypalToken() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");

  const res = await fetch(`${process.env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "authorization": `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || "Erro token PayPal");
  return data.access_token;
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj)
  };
}
