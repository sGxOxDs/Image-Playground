import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("shared Gateway authenticates sessions and assigns verified users", async (t) => {
  const requests = [];
  const gateway = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, authorization: req.headers.authorization,
      contentType: req.headers["content-type"], body: Buffer.concat(chunks).toString() });
    const prompt = req.headers["content-type"] === "application/json" && JSON.parse(requests.at(-1).body).prompt;
    if (prompt === "slow") return;
    if (prompt === "disconnect") return res.destroy();
    if (prompt === "error" || prompt === "large-error") {
      res.writeHead(429, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: prompt === "error" ? sharedKey : sharedKey.repeat(20_000) }));
    }
    if (prompt === "stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-transform" });
      res.write("data: first\n\n");
      await delay(200);
      return res.end("data: second\n\n");
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/v1/responses" ? { id: "resp_test" } : { data: [] }));
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(() => gateway.close());
  const portServer = createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const parent = "https://dashboard.example.test";
  const sharedKey = "test-shared-key";
  const key = Buffer.alloc(32, 7);
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const app = spawn(process.execPath, ["node_modules/@react-router/serve/bin.cjs", "build/server/index.js"], {
    cwd, stdio: "ignore", env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      IMAGE_STUDIO_STATIC_BUILD: "false", IMAGE_STUDIO_PLUGIN_ORIGIN: origin,
      LITELLM_PARENT_ORIGINS: parent, LITELLM_PLUGIN_NAME: "image-studio",
      LITELLM_API_BASE: `http://127.0.0.1:${gateway.address().port}`,
      LITELLM_SHARED_API_KEY: sharedKey, PLUGIN_AUTH_KEY: key.toString("base64url"),
      LITELLM_PROXY_UPLOAD_BUDGET_MIB: "512", LITELLM_PROXY_UPLOAD_TIMEOUT_MS: "1200",
      LITELLM_PROXY_UPSTREAM_TIMEOUT_MS: "1200" },
  });
  t.after(() => app.kill());
  for (let i = 0; ; i++) {
    try { await fetch(origin); break; }
    catch { if (i === 100) throw new Error("Server failed to start"); await new Promise((r) => setTimeout(r, 100)); }
  }
  function claim(user) {
    const now = Math.floor(Date.now() / 1000);
    const timestamp = Buffer.alloc(8); timestamp.writeBigUInt64BE(BigInt(now));
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-cbc", key.subarray(16), iv);
    const message = Buffer.concat([Buffer.from([0x80]), timestamp, iv,
      cipher.update(JSON.stringify({ plugin: "image-studio", user_id: user, user_role: "internal_user", exp: now + 30 })), cipher.final()]);
    return Buffer.concat([message, createHmac("sha256", key.subarray(0, 16)).update(message).digest()]).toString("base64url");
  }
  async function login(user) {
    const response = await fetch(origin + "/api/plugin-auth", { method: "POST",
      headers: { origin, "content-type": "text/plain" }, body: JSON.stringify({ session_claim: claim(user), parent_origin: parent }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sharedGateway, true);
    assert.ok(!JSON.stringify(result).includes(sharedKey));
    return result.token;
  }
  const alice = await login("alice");
  const bob = await login("bob");
  const send = (token, path, init = {}) => fetch(origin + "/api/gateway/v1/" + path, { ...init,
    headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  assert.equal((await send("", "models")).status, 401);
  assert.equal((await send(alice, "models")).status, 200);
  assert.equal(requests.at(-1).authorization, `Bearer ${sharedKey}`);
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await send(alice, "images/generations", json({ prompt: "test", user: "forged" }))).status, 200);
  assert.equal(JSON.parse(requests.at(-1).body).user, "alice");
  assert.equal((await send(alice, "images/generations", json({ prompt: "test", api_base: "https://untrusted.example" }))).status, 400);
  assert.equal((await send(alice, "images/generations", json({ prompt: "test", metadata: { trace_user_id: "bob" } }))).status, 400);
  const form = new FormData();
  form.append("user", "forged"); form.append("prompt", "test"); form.append("image", new Blob(["img"]), "image.png");
  assert.equal((await send(alice, "images/edits", { method: "POST", body: form })).status, 200);
  assert.match(requests.at(-1).body, /name="user"\r\n\r\nalice/);
  assert.doesNotMatch(requests.at(-1).body, /forged/);
  assert.equal((await send(alice, "responses", json({ model: "test" }))).status, 200);
  assert.equal((await send(bob, "responses/resp_test")).status, 403);
  assert.equal((await send(alice, "responses/resp_test")).status, 200);
  assert.equal((await send(alice, "responses/resp_test/cancel", { method: "POST" })).status, 200);
  assert.equal((await send(bob, "responses", json({ previous_response_id: "resp_test" }))).status, 403);
  assert.equal((await send(alice, "keys")).status, 404);
  assert.equal((await fetch(origin + "/api/gateway/v1/images/generations", { ...json({ prompt: "test" }),
    headers: { authorization: `Bearer ${alice}`, origin: "https://untrusted.example", "content-type": "application/json" } })).status, 403);

  await t.test("rejects overload before reading and releases reservations after timeout or cancellation", async () => {
    const headers = { origin, authorization: `Bearer ${alice}`, "content-type": "application/json" };
    function startUpload(extraHeaders = {}) {
      const upload = request(origin + "/api/gateway/v1/images/generations", {
        method: "POST", headers: { ...headers,
          ...("content-length" in extraHeaders ? extraHeaders : { "transfer-encoding": "chunked" }) },
      });
      upload.on("error", () => {});
      upload.flushHeaders();
      upload.write("{");
      return upload;
    }
    const normal = () => send(alice, "images/generations", json({ prompt: "test" }));
    async function waitForOverload() {
      // Let the pending upload arrive before making the first capacity probe.
      await delay(50);
      for (let i = 0; i < 20; i++) {
        const response = await normal();
        await response.arrayBuffer();
        if (response.status === 503) {
          assert.equal(response.headers.get("retry-after"), "2");
          return;
        }
        await delay(10);
      }
      assert.fail("Expected the incomplete chunked upload to reserve the full budget");
    }
    const timed = startUpload();
    const timedReply = once(timed, "response");
    await waitForOverload();
    const [response] = await timedReply;
    response.resume();
    assert.equal(response.statusCode, 408);
    timed.destroy();
    assert.equal((await normal()).status, 200);

    const cancelled = startUpload();
    await waitForOverload();
    cancelled.destroy();
    let recovered = false;
    for (let i = 0; i < 20 && !recovered; i++) {
      const reply = await normal();
      recovered = reply.status === 200;
      await reply.arrayBuffer();
      if (!recovered) await delay(10);
    }
    assert.ok(recovered);

    const oversized = startUpload({ "content-length": String(128 * 1024 * 1024 + 1) });
    const [tooLarge] = await once(oversized, "response");
    tooLarge.resume();
    assert.equal(tooLarge.statusCode, 413);
    oversized.destroy();

    const chunked = startUpload();
    const chunkedReply = once(chunked, "response");
    const chunk = Buffer.alloc(1024 * 1024);
    const writeChunks = async () => {
      for (let i = 0; i < 129 && !chunked.destroyed; i++) {
        if (!chunked.write(chunk)) {
          // The socket can close as soon as the server replies.
          await Promise.race([once(chunked, "drain"), chunkedReply]);
        }
      }
      if (!chunked.destroyed) chunked.end();
    };
    const writer = writeChunks();
    const [chunkedTooLarge] = await chunkedReply;
    chunkedTooLarge.resume();
    assert.equal(chunkedTooLarge.statusCode, 413);
    await writer;
  });

  await t.test("bounds upstream errors, handles disconnects and forwards SSE", async () => {
    const generate = (prompt) => send(alice, "images/generations", json({ prompt }));
    const small = await generate("error");
    assert.equal(small.status, 429);
    assert.equal((await small.json()).error, "••••");
    const large = await generate("large-error");
    assert.equal(large.status, 429);
    assert.deepEqual(await large.json(), { error: "共用 Gateway 回傳錯誤。" });
    assert.equal((await generate("disconnect")).status, 502);
    assert.equal((await generate("slow")).status, 504);
    const stream = await generate("stream");
    const reader = stream.body.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
    assert.equal(new TextDecoder().decode((await reader.read()).value), "data: second\n\n");
    assert.equal((await reader.read()).done, true);
  });
});
