import { createClient } from "@supabase/supabase-js";

/**
 * Route:
 *   /api/create-checkout-session
 *
 * ENV (Cloudflare Pages):
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SITE_URL
 */
export async function onRequest(context) {
  try {
    const { request, env } = context;

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // ✅ Valida ENV
    const missing = [];
    if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
    if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!env.SITE_URL) missing.push("SITE_URL");

    if (missing.length) {
      return json(500, { error: "Faltam variáveis no Cloudflare: " + missing.join(", ") });
    }

    const body = await request.json().catch(() => ({}));
    const { email, cart } = body;

    if (!email || !Array.isArray(cart) || !cart.length) {
      return json(400, { error: "Dados inválidos" });
    }

    const SITE_URL = env.SITE_URL;
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // ✅ Calcula total no server (não confiar no browser)
    let total = 0;
    const items = cart.map((it) => {
      const price = Number(it.price || 0);
      const qty = Math.max(1, Number(it.qty || 1));
      total += price * qty;
      return { ...it, price, qty };
    });

    // ✅ cria order pending
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert([
        {
          email,
          status: "pending",
          currency: "EUR",
          total,
          payment_provider: "stripe",
        },
      ])
      .select("*")
      .single();

    if (orderErr) return json(500, { error: orderErr.message });

    // ✅ guarda items
    const orderItems = items.map((it) => ({
      order_id: order.id,
      product_id: it.id,
      name: it.name,
      price: it.price,
      qty: it.qty,
    }));

    const { error: itemsErr } = await supabase.from("order_items").insert(orderItems);
    if (itemsErr) return json(500, { error: itemsErr.message });

    // ✅ Stripe Checkout Session via API (Workers-friendly)
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("customer_email", email);

    form.set(
      "success_url",
      `${SITE_URL}/success.html?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`
    );
    form.set("cancel_url", `${SITE_URL}/cancel.html?order=${order.id}`);

    // payment_method_types[]=card (Checkout hoje costuma escolher automaticamente, mas mantemos igual)
    form.append("payment_method_types[]", "card");

    // metadata[order_id]
    form.set("metadata[order_id]", String(order.id));

    // line_items
    items.forEach((it, idx) => {
      form.set(`line_items[${idx}][quantity]`, String(it.qty));
      form.set(`line_items[${idx}][price_data][currency]`, "eur");
      form.set(
        `line_items[${idx}][price_data][unit_amount]`,
        String(Math.round(it.price * 100))
      );
      form.set(`line_items[${idx}][price_data][product_data][name]`, it.name || "Produto");
    });

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.log("STRIPE ERROR:", session);
      return json(500, {
        error: session?.error?.message || "Erro ao criar sessão Stripe",
      });
    }

    return json(200, { url: session.url });
  } catch (e) {
    return json(500, { error: e?.message || "Erro" });
  }
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
