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
  POLL_AFTER_MS,
  resolvePublicBaseUrl
} from "./pairing";
import { PairingSessionObject } from "./pairingSessionObject";
import { renderAppleMusicPairPage, renderHomePage } from "./html";
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

app.get("/api/health", (context) => {
  return context.json({
    ok: true,
    appleDeveloperTokenConfigured: hasDeveloperTokenSource(context.env),
    developerTokenSource: getDeveloperTokenSource(context.env) ?? "missing"
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
  const session = createPairingSession();
  const pairUrl =
    createPairUrl(
      resolvePublicBaseUrl(context.env.PUBLIC_BASE_URL, context.req.raw),
      session
    );
  const object = pairingObject(context.env, session.sessionId);
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
});

app.get("/api/pairing/status", async (context) => {
  const sessionId = context.req.query("sessionId") ?? "";
  const watchSecret =
    readBearerToken(context.req.raw) ??
    context.req.query("watchSecret") ??
    "";

  if (!sessionId) {
    return jsonResponse({ error: "Missing sessionId" }, 400);
  }

  const object = pairingObject(context.env, sessionId);
  const objectResponse =
    await object.fetch(
      `https://pairing-session/status?watchSecret=${encodeURIComponent(watchSecret)}`
    );
  const payload = await objectResponse.json<Record<string, unknown>>();

  if (!objectResponse.ok || payload.status !== "authorized") {
    return jsonResponse(payload, objectResponse.status);
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

export default app;
