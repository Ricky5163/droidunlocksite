const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { paypalOrderId } = body;
    if (!paypalOrderId) return json(400, { error: "paypalOrderId obrigatório" });

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const token = await paypalToken();

    const res = await fetch(`${process.env.PAYPAL_API_BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers: { "authorization": `Bearer ${token}` }
    });

    const data = await res.json();
    if (!res.ok) return json(500, { error: data?.message || "Erro capture PayPal" });

    // marcar paid no Supabase
    await sb.from("orders").update({ status: "paid" }).eq("paypal_order_id", paypalOrderId);

    return json(200, { ok: true });
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
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}
