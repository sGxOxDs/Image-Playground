import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const MiB = 1024 * 1024;
const key = Buffer.alloc(32, 7);
const parentOrigin = "https://dashboard.example.test";
const print = (report) => console.log(JSON.stringify(report));
const round = (number) => Math.round(number * 100) / 100;

function monitor() {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let cpu = process.cpuUsage();
  let time = performance.now();
  setInterval(() => {
    const now = performance.now();
    const usage = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const { rss, heapUsed, external } = process.memoryUsage();
    print({ type: "node", pid: process.pid, rssMiB: round(rss / MiB),
      peakRssMiB: round(process.resourceUsage().maxRSS / 1024),
      heapMiB: round(heapUsed / MiB), externalMiB: round(external / MiB),
      cpuPercent: round((usage.user + usage.system) / ((now - time) * 10)),
      loopP99Ms: round(loop.percentile(99) / 1e6) });
    time = now;
    loop.reset();
  }, 1000).unref();
}

function mock() {
  const upstreamDelay = Number(process.env.MOCK_DELAY_MS ?? 100);
  createServer(async (request, response) => {
    try {
      for await (const _ of request) { /* Drain uploads without retaining them. */ }
      const url = new URL(request.url, "http://mock");
      if (url.pathname === "/v1/chat/completions") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-transform" });
        response.write("data: first\n\n");
        await delay(upstreamDelay);
        return response.end("data: [DONE]\n\n");
      }
      if (request.method === "POST") await delay(upstreamDelay);
      const payload = url.pathname.startsWith("/v1/responses") ? { id: "resp_benchmark", status: "completed" } : { data: [] };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    } catch {
      response.destroy();
    }
  }).listen(4000, "0.0.0.0");
}

function claim() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.alloc(9);
  header[0] = 0x80;
  header.writeBigUInt64BE(BigInt(now), 1);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", key.subarray(16), iv);
  const payload = { plugin: "image-studio", user_id: "benchmark", user_role: "internal_user", exp: now + 30 };
  const message = Buffer.concat([header, iv, cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([message, createHmac("sha256", key.subarray(0, 16)).update(message).digest()]).toString("base64url");
}

async function run(origin, mode, seconds) {
  async function login() {
    return fetch(origin + "/api/plugin-auth", {
      method: "POST", headers: { origin, "content-type": "text/plain" },
      body: JSON.stringify({ session_claim: claim(), parent_origin: parentOrigin }),
    });
  }

  const initialLogin = await login();
  if (!initialLogin.ok) throw new Error(`Benchmark login failed: ${initialLogin.status}`);
  let { token } = await initialLogin.json();
  let loginTime = performance.now();
  const proxy = (path, body, contentType) => fetch(origin + "/api/gateway/v1/" + path, {
    method: body === undefined ? "GET" : "POST", body, signal: AbortSignal.timeout(30_000),
    headers: { origin, authorization: `Bearer ${token}`, ...(contentType && { "content-type": contentType }) },
  });
  const json = (path, body) => proxy(path, body, "application/json");
  const generate = () => json("images/generations", '{"model":"mock","prompt":"benchmark"}');
  const sse = () => json("chat/completions", '{"model":"mock","stream":true}');

  async function measure(name, operation, concurrency, durationMs, intervalMs = 0) {
    const latencies = [];
    const firstBytes = [];
    const statuses = {};
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      do {
        const begin = performance.now();
        let status = "network_error";
        try {
          const response = await operation();
          if (response.body) {
            const reader = response.body.getReader();
            let chunk = await reader.read();
            if (response.ok && !chunk.done) firstBytes.push(performance.now() - begin);
            while (!chunk.done) chunk = await reader.read();
          }
          status = response.status;
        } catch {
          // Include interrupted requests in throughput and status counts.
        }
        statuses[status] = (statuses[status] ?? 0) + 1;
        if (status === 200) latencies.push(performance.now() - begin);
        if (status === 503 || status === "network_error") await delay(100);
        const wait = intervalMs - (performance.now() - begin);
        if (wait > 0) await delay(wait);
      } while (performance.now() - started < durationMs);
    }));
    const seconds = (performance.now() - started) / 1000;
    const percentile = (values, fraction) => values.length ? round(values[Math.ceil(values.length * fraction) - 1]) : null;
    latencies.sort((a, b) => a - b);
    firstBytes.sort((a, b) => a - b);
    print({ type: "load", name, concurrency, seconds: round(seconds), statuses, okPerSecond: round(latencies.length / seconds),
      p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99),
      firstByteP95Ms: percentile(firstBytes, 0.95) });
  }

  function edit(mib) {
    const file = new Blob([Buffer.alloc(mib * MiB, 1)], { type: "image/png" });
    return () => {
      const form = new FormData();
      form.append("image", file, "benchmark.png");
      form.append("prompt", "benchmark");
      return proxy("images/edits", form);
    };
  }

  if (mode !== "soak") {
    const home = await fetch(origin);
    const asset = (await home.text()).match(/\/assets\/[^"' ]+\.js/)?.[0];
    if (!asset) throw new Error("Could not find a static asset in the home page");
    const short = [
      ["home", () => fetch(origin)], ["asset", () => fetch(origin + asset)],
      ["login", login], ["models", () => proxy("models")], ["generate", generate], ["sse", sse],
    ];
    await generate().then((response) => response.arrayBuffer());
    if (mode === "normal") {
      for (const [name, operation] of short) await measure(name, operation, 4, seconds * 1000, 200);
      await measure("multipart-1MiB", edit(1), 4, seconds * 1000, 300);
      return;
    }
    for (const [name, operation] of short) await measure(name, operation, 8, 1500);
    for (const mb of [1, 8, 32]) {
      const upload = edit(mb);
      const base64 = Buffer.alloc(mb * MiB, 1).toString("base64");
      const body = JSON.stringify({ input: [{ content: [{ type: "input_image", image_url: "data:image/png;base64," + base64 }] }] });
      for (const concurrency of [1, 4, 8, 16]) {
        await measure(`multipart-${mb}MiB`, upload, concurrency, 1500);
        await measure(`responses-${mb}MiB`, () => json("responses", body), concurrency, 1500);
      }
    }
    await measure("poll", () => proxy("responses/resp_benchmark"), 8, 1500);
  }

  if (seconds > 0) {
    const upload = edit(32);
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      if (performance.now() - loginTime > 20 * 60 * 1000) {
        const refreshed = await login();
        if (!refreshed.ok) throw new Error(`Benchmark login refresh failed: ${refreshed.status}`);
        ({ token } = await refreshed.json());
        loginTime = performance.now();
      }
      await measure("soak-multipart", upload, 16, Math.min(30_000, end - performance.now()));
      await measure("soak-recovery", generate, 1, 0);
    }
  }
}

if (process.env.PERF_TELEMETRY === "1") monitor();
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [mode, origin, seconds = mode === "normal" ? "15" : "0"] = process.argv.slice(2);
  if (mode === "mock") mock();
  else if (["run", "normal", "soak"].includes(mode) && origin && /^\d+$/.test(seconds)) {
    await run(new URL(origin).origin, mode, Number(seconds));
  } else {
    throw new Error("Usage: node gateway-benchmark.mjs mock | run ORIGIN [SOAK_SECONDS] | normal ORIGIN [SECONDS] | soak ORIGIN SECONDS");
  }
}
