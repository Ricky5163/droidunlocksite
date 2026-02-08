const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    const { email, cart } = JSON.parse(event.body || "{}");
    if (!email || !Array.isArray(cart) || !cart.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Dados inválidos" }) };
    }

    const SITE_URL = process.env.SITE_URL;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Calcula total no server (não confiar no browser)
    let total = 0;
    const items = cart.map(it => {
      const price = Number(it.price || 0);
      const qty = Math.max(1, Number(it.qty || 1));
      total += price * qty;
      return { ...it, price, qty };
    });

    // cria order pending
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert([{ email, status: "pending", currency: "EUR", total, payment_provider: "stripe" }])
      .select("*")
      .single();

    if (orderErr) throw orderErr;

    // guarda items
    const orderItems = items.map(it => ({
      order_id: order.id,
      product_id: it.id,
      name: it.name,
      price: it.price,
      qty: it.qty
    }));
    const { error: itemsErr } = await supabase.from("order_items").insert(orderItems);
    if (itemsErr) throw itemsErr;

    const line_items = items.map(it => ({
      quantity: it.qty,
      price_data: {
        currency: "eur",
        unit_amount: Math.round(it.price * 100),
        product_data: { name: it.name || "Produto" }
      }
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items,
      success_url: `${SITE_URL}/success.html?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cancel.html?order=${order.id}`,
      payment_method_types: ["card"],

      // Importante: MB WAY / Multibanco aparecem se estiverem ativados na tua conta Stripe e país/condições ok
      // O Stripe Checkout mostra métodos elegíveis automaticamente (quando ativados).
      metadata: { order_id: order.id }
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Erro" }) };
  }
};
