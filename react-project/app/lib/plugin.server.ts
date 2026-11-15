import { createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parentOrigins } from "./plugin-origins.server";

import { pluginName } from "./plugin-manifest.server";
const claimLifetime = 30;
const sessionLifetime = 30 * 60;
const usedClaims = new Map<string, number>();

export type PluginIdentity = { userId: string; role: string; namespace: string; expiresAt: number };
const sessions = new Map<string, PluginIdentity>();

export class PluginError extends Error {
  constructor(message: string, public status = 401) { super(message); }
}

export function assertPluginOrigin(request: Request) {
  const origin = process.env.IMAGE_STUDIO_PLUGIN_ORIGIN || new URL(request.url).origin;
  if (request.method !== "GET" && request.headers.get("origin") !== origin) {
    throw new PluginError("請從工作台送出同源請求。", 403);
  }
}

const digest = (buffer: string | Buffer) => createHash("sha256").update(buffer).digest("hex");

function prune(now: number) {
  for (const [claim, expires] of usedClaims) if (expires <= now) usedClaims.delete(claim);
  for (const [token, identity] of sessions) if (identity.expiresAt <= now * 1000) sessions.delete(token);
}

function decodeClaim(claim: string, now: number) {
  const configured = process.env.PLUGIN_AUTH_KEY;
  const key = Buffer.from(configured ?? "", "base64url");
  if (key.length !== 32 || !parentOrigins().length) {
    throw new PluginError("伺服器尚未設定 LiteLLM Plugin。", 503);
  }
  if (!/^[A-Za-z0-9_-]{80,8192}={0,2}$/.test(claim)) throw new PluginError("LiteLLM 身分聲明無效。");
  const token = Buffer.from(claim, "base64url");
  if (token.length < 73 || token[0] !== 0x80 || (token.length - 57) % 16 !== 0) {
    throw new PluginError("LiteLLM 身分聲明無效。");
  }
  const message = token.subarray(0, -32);
  const signature = createHmac("sha256", key.subarray(0, 16)).update(message).digest();
  if (!timingSafeEqual(signature, token.subarray(-32))) throw new PluginError("LiteLLM 身分聲明無效。");
  const issuedAt = token.readBigUInt64BE(1);
  if (issuedAt > BigInt(now + 5) || issuedAt + BigInt(claimLifetime) < BigInt(now)) {
    throw new PluginError("LiteLLM 身分聲明已過期或時間不符。");
  }
  try {
    const decipher = createDecipheriv("aes-128-cbc", key.subarray(16), token.subarray(9, 25));
    const payload = JSON.parse(Buffer.concat([decipher.update(message.subarray(25)), decipher.final()]).toString("utf8"));
    const { plugin, exp, user_id, user_role } = payload ?? {};
    if (plugin !== pluginName || !Number.isSafeInteger(exp) || exp <= now || exp > Number(issuedAt) + claimLifetime
        || typeof user_id !== "string" || !user_id.trim() || user_id.length > 400
        || typeof user_role !== "string" || !user_role.trim() || user_role.length > 120) {
      throw new Error("Invalid claim");
    }
    return { userId: user_id, role: user_role, claimId: digest(token), claimExpiry: exp };
  } catch { throw new PluginError("LiteLLM 身分聲明無效或已過期。"); }
}

export function exchangeClaim(claim: string, parent: string, previousToken?: string) {
  if (!parentOrigins().includes(parent)) throw new PluginError("LiteLLM 父視窗來源不受信任。", 403);
  const now = Math.floor(Date.now() / 1000);
  const { userId, role, claimId, claimExpiry } = decodeClaim(claim, now);
  prune(now);
  if (usedClaims.has(claimId)) throw new PluginError("此 LiteLLM 身分聲明已使用。");
  usedClaims.set(claimId, claimExpiry);
  const token = randomBytes(32).toString("base64url");
  const gatewayBaseUrl = process.env.LITELLM_BROWSER_API_BASE || parent;
  const gateway = process.env.LITELLM_GATEWAY_ID || process.env.LITELLM_API_BASE || gatewayBaseUrl;
  const identity = { userId, role, expiresAt: (now + sessionLifetime) * 1000,
    namespace: digest(JSON.stringify([gateway, pluginName, userId])) };
  if (previousToken) sessions.delete(digest(previousToken));
  sessions.set(digest(token), identity);
  return { token, ...identity, gatewayBaseUrl };
}

export function getPluginSession(request: Request): PluginIdentity | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) return undefined;
  assertPluginOrigin(request);
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  const identity = token && sessions.get(digest(token));
  if (!identity) throw new PluginError("LiteLLM Session 無效，請重新連線。");
  if (identity.expiresAt <= Date.now()) {
    sessions.delete(digest(token));
    throw new PluginError("LiteLLM Session 已過期，請重新連線。");
  }
  return identity;
}

export function pluginFailure(error: unknown) {
  return Response.json({ error: error instanceof PluginError ? error.message : "無法驗證 LiteLLM 身分。" },
    { status: error instanceof PluginError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
