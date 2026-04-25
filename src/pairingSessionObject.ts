import { sha256Hex } from "./crypto";
import { HttpError, jsonResponse, parseJsonBody } from "./http";
import { isExpired } from "./pairing";
import type {
  CompleteOAuthPairingInput,
  CompletePairingInput,
  Env,
  PairingSessionRecord,
  PrepareOAuthPairingInput,
  StartPairingInput
} from "./types";

const SESSION_KEY = "session";

export class PairingSessionObject {
  constructor(
    private readonly state: DurableObjectState,
    env: Env
  ) {
    void env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/start") {
        return await this.start(request);
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return await this.status(url.searchParams.get("watchSecret") ?? "");
      }

      if (request.method === "POST" && url.pathname === "/complete") {
        return await this.complete(request);
      }

      if (request.method === "POST" && url.pathname === "/oauth/prepare") {
        return await this.prepareOAuth(request);
      }

      if (request.method === "POST" && url.pathname === "/oauth/complete") {
        return await this.completeOAuth(request);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }

  private async start(request: Request): Promise<Response> {
    const input = await parseJsonBody<StartPairingInput>(request);
    const existing = await this.state.storage.get<PairingSessionRecord>(SESSION_KEY);

    if (existing) {
      return jsonResponse({ error: "Pairing session already exists" }, 409);
    }

    const record: PairingSessionRecord = {
      sessionId: input.sessionId,
      code: input.code,
      phoneSecretHash: await sha256Hex(input.phoneSecret),
      watchSecretHash: await sha256Hex(input.watchSecret),
      status: "pending",
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    };

    await this.state.storage.put(SESSION_KEY, record);
    await this.state.storage.setAlarm(input.expiresAt + 60_000);

    return jsonResponse({
      status: record.status,
      code: record.code,
      expiresAt: record.expiresAt
    });
  }

  private async status(watchSecret: string): Promise<Response> {
    if (!watchSecret) {
      return jsonResponse({ error: "Missing watch secret" }, 401);
    }

    const record = await this.getActiveRecord();
    if (!record) {
      return jsonResponse({ status: "expired" });
    }

    if (await sha256Hex(watchSecret) !== record.watchSecretHash) {
      return jsonResponse({ error: "Invalid watch secret" }, 403);
    }

    if (record.status === "authorized") {
      const musicUserToken = record.musicUserToken;
      const authorizedPayload = record.authorizedPayload ?? {};
      await this.state.storage.deleteAll();

      return jsonResponse({
        status: "authorized",
        musicUserToken,
        ...authorizedPayload
      });
    }

    return jsonResponse({
      status: record.status,
      expiresAt: record.expiresAt
    });
  }

  private async complete(request: Request): Promise<Response> {
    const input = await parseJsonBody<CompletePairingInput>(request);

    if (!input.phoneSecret) {
      return jsonResponse({ error: "Missing phone secret" }, 401);
    }

    if (!input.musicUserToken?.trim()) {
      return jsonResponse({ error: "Missing Apple Music user token" }, 400);
    }

    const record = await this.getActiveRecord();
    if (!record) {
      return jsonResponse({ status: "expired" }, 410);
    }

    if (record.status !== "pending") {
      return jsonResponse({ status: record.status }, 409);
    }

    if (await sha256Hex(input.phoneSecret) !== record.phoneSecretHash) {
      return jsonResponse({ error: "Invalid phone secret" }, 403);
    }

    await this.state.storage.put<PairingSessionRecord>(SESSION_KEY, {
      ...record,
      status: "authorized",
      musicUserToken: input.musicUserToken.trim()
    });

    return jsonResponse({
      status: "authorized"
    });
  }

  private async prepareOAuth(request: Request): Promise<Response> {
    const input = await parseJsonBody<PrepareOAuthPairingInput>(request);

    if (!input.phoneSecret) {
      return jsonResponse({ error: "Missing phone secret" }, 401);
    }

    if (!input.stateSecret?.trim()) {
      return jsonResponse({ error: "Missing OAuth state secret" }, 400);
    }

    const record = await this.getActiveRecord();
    if (!record) {
      return jsonResponse({ status: "expired" }, 410);
    }

    if (record.status !== "pending") {
      return jsonResponse({ status: record.status }, 409);
    }

    if (await sha256Hex(input.phoneSecret) !== record.phoneSecretHash) {
      return jsonResponse({ error: "Invalid phone secret" }, 403);
    }

    await this.state.storage.put<PairingSessionRecord>(SESSION_KEY, {
      ...record,
      oauthStateHash: await sha256Hex(input.stateSecret)
    });

    return jsonResponse({
      status: "pending",
      expiresAt: record.expiresAt
    });
  }

  private async completeOAuth(request: Request): Promise<Response> {
    const input = await parseJsonBody<CompleteOAuthPairingInput>(request);

    if (!input.stateSecret?.trim()) {
      return jsonResponse({ error: "Missing OAuth state secret" }, 401);
    }

    if (!isRecord(input.authorizedPayload)) {
      return jsonResponse({ error: "Missing authorized payload" }, 400);
    }

    const record = await this.getActiveRecord();
    if (!record) {
      return jsonResponse({ status: "expired" }, 410);
    }

    if (record.status !== "pending") {
      return jsonResponse({ status: record.status }, 409);
    }

    if (!record.oauthStateHash) {
      return jsonResponse({ error: "OAuth state is not prepared" }, 409);
    }

    if (await sha256Hex(input.stateSecret) !== record.oauthStateHash) {
      return jsonResponse({ error: "Invalid OAuth state" }, 403);
    }

    await this.state.storage.put<PairingSessionRecord>(SESSION_KEY, {
      ...record,
      status: "authorized",
      authorizedPayload: input.authorizedPayload
    });

    return jsonResponse({
      status: "authorized"
    });
  }

  private async getActiveRecord(): Promise<PairingSessionRecord | undefined> {
    const record = await this.state.storage.get<PairingSessionRecord>(SESSION_KEY);

    if (!record) {
      return undefined;
    }

    if (isExpired(record.expiresAt)) {
      await this.state.storage.deleteAll();
      return undefined;
    }

    return record;
  }

  private errorResponse(error: unknown): Response {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
