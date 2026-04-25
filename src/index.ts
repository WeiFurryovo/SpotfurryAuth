import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getDeveloperTokenSource,
  getAppleDeveloperToken,
  hasDeveloperTokenSource
} from "./appleDeveloperToken";
import {
  HttpError,
  htmlResponse,
  jsonResponse,
  parseJsonBody,
  readBearerToken
} from "./http";
import {
  createPairingSession,
  createPairUrl,
  type PairingProvider,
  POLL_AFTER_MS,
  resolvePublicBaseUrl
} from "./pairing";
import { PairingSessionObject } from "./pairingSessionObject";
import { randomBase64Url } from "./crypto";
import {
  createSpotifyAuthorizeUrl,
  createSpotifyOAuthState,
  exchangeSpotifyCodeForToken,
  hasSpotifyOAuthConfig,
  parseSpotifyOAuthState
} from "./spotify";
import {
  renderAppleMusicPairPage,
  renderHomePage,
  renderSpotifyPairPage,
  renderSpotifyPairResultPage
} from "./html";
import type {
  CompletePairingInput,
  Env,
  StartPairingResponse
} from "./types";

export { PairingSessionObject };

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/", () => htmlResponse(renderHomePage()));

app.get("/apple-music/pair", (context) => {
  return htmlResponse(
    renderAppleMusicPairPage({
      sessionId: context.req.query("s"),
      phoneSecret: context.req.query("p"),
      code: context.req.query("code")
    })
  );
});

app.get("/spotify/pair", (context) => {
  return htmlResponse(
    renderSpotifyPairPage({
      sessionId: context.req.query("s"),
      phoneSecret: context.req.query("p"),
      code: context.req.query("code")
    })
  );
});

app.get("/spotify/login", async (context) => {
  const sessionId = context.req.query("s")?.trim() ?? "";
  const phoneSecret = context.req.query("p")?.trim() ?? "";

  if (!sessionId || !phoneSecret) {
    return spotifyResult(
      "无法连接 Spotify",
      "配对链接缺少必要参数。请回到手表刷新二维码后重试。",
      false,
      400
    );
  }

  if (!hasSpotifyOAuthConfig(context.env)) {
    return spotifyResult(
      "Spotify 后端未配置",
      "请先在 Cloudflare Worker Secrets 中配置 SPOTIFY_CLIENT_ID 和 SPOTIFY_CLIENT_SECRET。",
      false,
      503
    );
  }

  const stateSecret = randomBase64Url(32);
  const objectResponse =
    await pairingObject(context.env, sessionId).fetch(
      "https://pairing-session/oauth/prepare",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          phoneSecret,
          stateSecret
        })
      }
    );

  if (!objectResponse.ok) {
    return spotifyResult(
      "无法连接 Spotify",
      await readPairingError(objectResponse, "无法准备 Spotify OAuth 状态"),
      false,
      objectResponse.status
    );
  }

  const publicBaseUrl =
    resolvePublicBaseUrl(context.env.PUBLIC_BASE_URL, context.req.raw);
  const state = createSpotifyOAuthState(sessionId, stateSecret);
  const authorizeUrl =
    createSpotifyAuthorizeUrl({
      env: context.env,
      publicBaseUrl,
      state
    });

  return Response.redirect(authorizeUrl, 302);
});

app.get("/spotify/callback", async (context) => {
  const error = context.req.query("error")?.trim();
  if (error) {
    return spotifyResult(
      "Spotify 授权已取消",
      `Spotify 返回错误：${error}`,
      false,
      400
    );
  }

  const code = context.req.query("code")?.trim() ?? "";
  const state = parseSpotifyOAuthState(context.req.query("state") ?? "");
  if (!code || !state) {
    return spotifyResult(
      "Spotify 回调无效",
      "回调缺少 code 或 state，请回到手表刷新二维码后重试。",
      false,
      400
    );
  }

  const publicBaseUrl =
    resolvePublicBaseUrl(context.env.PUBLIC_BASE_URL, context.req.raw);
  const authorizedPayloadResult =
    await runSpotifyTokenExchange(async () => exchangeSpotifyCodeForToken({
      env: context.env,
      publicBaseUrl,
      code
    }));
  if (authorizedPayloadResult instanceof Response) {
    return authorizedPayloadResult;
  }

  const objectResponse =
    await pairingObject(context.env, state.sessionId).fetch(
      "https://pairing-session/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stateSecret: state.stateSecret,
          authorizedPayload: authorizedPayloadResult
        })
      }
    );

  if (!objectResponse.ok) {
    return spotifyResult(
      "Spotify 授权未写入手表会话",
      await readPairingError(objectResponse, "无法完成 Spotify 手表配对"),
      false,
      objectResponse.status
    );
  }

  return spotifyResult(
    "Spotify 已连接",
    "登录成功，可以回到手表继续播放。",
    true
  );
});

app.get("/api/health", (context) => {
  return context.json({
    ok: true,
    appleDeveloperTokenConfigured: hasDeveloperTokenSource(context.env),
    developerTokenSource: getDeveloperTokenSource(context.env) ?? "missing",
    spotifyOAuthConfigured: hasSpotifyOAuthConfig(context.env)
  });
});

app.get("/api/apple/developer-token", async (context) => {
  if (!hasDeveloperTokenSource(context.env)) {
    return jsonResponse(
      {
        error: "Apple Music developer token source is not configured"
      },
      503
    );
  }

  return jsonResponse(await getAppleDeveloperToken(context.env));
});

app.post("/api/pairing/start", async (context) => {
  return await startPairing(
    context.env,
    context.req.raw,
    "apple-music"
  );
});

app.post("/api/spotify/pairing/start", async (context) => {
  return await startPairing(
    context.env,
    context.req.raw,
    "spotify"
  );
});

app.get("/api/spotify/pairing/status", async (context) => {
  const sessionId = context.req.query("sessionId") ?? "";
  const watchSecret =
    readBearerToken(context.req.raw) ??
    context.req.query("watchSecret") ??
    "";

  if (!sessionId) {
    return jsonResponse({ error: "Missing sessionId" }, 400);
  }

  const statusResult =
    await fetchPairingStatus(context.env, sessionId, watchSecret);

  return jsonResponse(statusResult.payload, statusResult.status);
});

async function startPairing(
  env: Env,
  request: Request,
  provider: PairingProvider
): Promise<Response> {
  const session = createPairingSession();
  const pairUrl =
    createPairUrl(
      resolvePublicBaseUrl(env.PUBLIC_BASE_URL, request),
      session,
      provider
    );
  const object = pairingObject(env, session.sessionId);
  const objectResponse =
    await object.fetch(
      "https://pairing-session/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(session)
      }
    );

  if (!objectResponse.ok) {
    return objectResponse;
  }

  const response: StartPairingResponse = {
    sessionId: session.sessionId,
    watchSecret: session.watchSecret,
    code: session.code,
    pairUrl,
    expiresAt: session.expiresAt,
    pollAfterMs: POLL_AFTER_MS
  };

  return jsonResponse(response);
}

app.get("/api/pairing/status", async (context) => {
  const sessionId = context.req.query("sessionId") ?? "";
  const watchSecret =
    readBearerToken(context.req.raw) ??
    context.req.query("watchSecret") ??
    "";

  if (!sessionId) {
    return jsonResponse({ error: "Missing sessionId" }, 400);
  }

  const statusResult =
    await fetchPairingStatus(context.env, sessionId, watchSecret);
  const payload = statusResult.payload;

  if (
    statusResult.status < 200 ||
    statusResult.status >= 300 ||
    payload.status !== "authorized"
  ) {
    return jsonResponse(payload, statusResult.status);
  }

  if (hasDeveloperTokenSource(context.env)) {
    const developerToken = await getAppleDeveloperToken(context.env);
    return jsonResponse({
      ...payload,
      ...developerToken
    });
  }

  return jsonResponse({
    ...payload,
    developerTokenAvailable: false
  });
});

app.post("/api/pairing/complete", async (context) => {
  const input = await parseJsonBody<CompletePairingInput>(context.req.raw);
  const sessionId = input.sessionId?.trim();

  if (!sessionId) {
    return jsonResponse({ error: "Missing sessionId" }, 400);
  }

  return await pairingObject(context.env, sessionId).fetch(
    "https://pairing-session/complete",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );
});

app.notFound(() => jsonResponse({ error: "Not found" }, 404));

app.onError((error) => {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  return jsonResponse(
    {
      error: error instanceof Error ? error.message : "Unknown error"
    },
    500
  );
});

function pairingObject(
  env: Env,
  sessionId: string
): DurableObjectStub {
  return env.PAIRING_SESSION.get(env.PAIRING_SESSION.idFromName(sessionId));
}

async function fetchPairingStatus(
  env: Env,
  sessionId: string,
  watchSecret: string
): Promise<{ payload: Record<string, unknown>; status: number }> {
  const objectResponse =
    await pairingObject(env, sessionId).fetch(
      `https://pairing-session/status?watchSecret=${encodeURIComponent(watchSecret)}`
    );
  const payload = await objectResponse.json<Record<string, unknown>>();

  return {
    payload,
    status: objectResponse.status
  };
}

function spotifyResult(
  title: string,
  message: string,
  succeeded: boolean,
  status: number = 200
): Response {
  return htmlResponse(
    renderSpotifyPairResultPage({
      succeeded,
      title,
      message
    }),
    status
  );
}

async function readPairingError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = await response.json<Record<string, unknown>>();
    const error = payload.error;
    const status = payload.status;

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }

    if (typeof status === "string" && status.trim()) {
      return `配对状态：${status}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function runSpotifyTokenExchange<T>(
  action: () => Promise<T>
): Promise<T | Response> {
  try {
    return await action();
  } catch (error) {
    return spotifyResult(
      "Spotify 换取 token 失败",
      error instanceof Error ? error.message : "未知错误",
      false,
      error instanceof HttpError ? error.status : 500
    );
  }
}

export default app;
