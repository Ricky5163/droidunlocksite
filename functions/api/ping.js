export async function onRequest() {
  return new Response("pong", { status: 200 });
}
