import { createClient } from "@supabase/supabase-js";

    const cors = {
  "Access-Control-Allow-Origin": "https://droidunclock.site",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};


export async function onRequest(context) {
  try {
    const { request, env } = context;

if (request.method === "OPTIONS") {
  return new Response(null, { status: 204, headers: cors });
}

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // env obrigatórias
    const missing = [];
    if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!env.SITE_URL) missing.push("SITE_URL");

    if (!env.PAYPAL_API_BASE) missing.push("PAYPAL_API_BASE");
    if (!env.PAYPAL_CLIENT_ID) missing.push("PAYPAL_CLIENT_ID");
    if (!env.PAYPAL_CLIENT_SECRET) missing.push("PAYPAL_CLIENT_SECRET");

    if (missing.length) return json(500, { error: "Missing env: " + missing.join(", ") });

    const body = await request.json().catch(() => ({}));
    const { email, cart } = body;

    if (!email || !Array.isArray(cart) || cart.length === 0) {
      return json(400, { error: "Dados inválidos." });
    }

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const total = cart.reduce(
      (s, it) => s + Number(it.price || 0) * Math.max(1, Number(it.qty || 1)),
      0
    );

    // cria order pending
    const { data: order, error: e1 } = await sb
      .from("orders")
      .insert([{
        email,
        status: "pending",
        currency: "EUR",
        total,
        payment_provider: "paypal",
      }])
      .select("*")
      .single();

    if (e1) return json(500, { error: e1.message });

    // order items
    const items = cart.map((it) => ({
      order_id: order.id,
      product_id: it.id,
      name: it.name,
      price: Number(it.price || 0),
      qty: Math.max(1, Number(it.qty || 1)),
    }));

    const { error: e2 } = await sb.from("order_items").insert(items);
    if (e2) return json(500, { error: e2.message });

    // token PayPal
    const token = await paypalToken(env);

    // cria order PayPal
    const ppRes = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: String(order.id),
          amount: { currency_code: "EUR", value: total.toFixed(2) },
        }],
        application_context: {
          return_url: `${env.SITE_URL}/success.html?order=${order.id}`,
          cancel_url: `${env.SITE_URL}/cancel.html?order=${order.id}`,
        },
      }),
    });

    const data = await ppRes.json();
    if (!ppRes.ok) {
      return json(500, { error: data?.message || data?.error_description || "Erro PayPal" });
    }

    // guarda paypal_order_id
    await sb.from("orders").update({ paypal_order_id: data.id }).eq("id", order.id);

    const approval = (data.links || []).find((l) => l.rel === "approve")?.href;
    if (!approval) return json(500, { error: "Approval link não encontrado" });

    return json(200, { approval_url: approval, paypal_order_id: data.id, order_id: order.id });
  } catch (err) {
    return json(500, { error: err?.message || "Erro" });
  }
}

async function paypalToken(env) {
  const basic = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);

  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || "Erro token PayPal");
  return data.access_token;
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...cors,
    },
  });
}