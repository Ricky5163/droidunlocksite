import { createClient } from "@supabase/supabase-js";

/**
 * Route:
 *   POST /api/stripe-webhook
 *
 * ENV:
 *   STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ✅ Lê o body RAW (não uses request.json aqui)
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  if (!sigHeader) return new Response("Missing stripe-signature", { status: 400 });

  // ✅ Valida ENV
  const missing = [];
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) return new Response("Missing env: " + missing.join(", "), { status: 500 });

  // ✅ Verifica assinatura Stripe
  const ok = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("Invalid signature", { status: 400 });

  // ✅ Parse do evento (agora sim)
  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    if (evt.type === "checkout.session.completed") {
      const session = evt.data?.object;
      const orderId = session?.metadata?.order_id;

      if (orderId) {
        await sb
          .from("orders")
          .update({
            status: "paid",
            stripe_payment_intent_id: session.payment_intent ?? null,
          })
          .eq("id", orderId);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    return new Response(err?.message || "Server error", { status: 500 });
  }
}

// -------------------------
// Stripe signature verify
// -------------------------
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  // sigHeader example: "t=...,v1=...,v0=..."
  const parts = sigHeader.split(",").map((s) => s.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));

  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);

  // (opcional) tolerância de tempo (5 min)
  const now = Math.floor(Date.now() / 1000);
  const tNum = Number(timestamp);
  if (!Number.isFinite(tNum) || Math.abs(now - tNum) > 300) {
    // se quiseres aceitar mais tempo, aumenta 300
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  return timingSafeEqual(expected, signature);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufToHex(sig);
}

function bufToHex(buf) {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// Comparação resistente a timing
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
