export function jsonResponse(
  body: unknown,
  init: ResponseInit | number = 200
): Response {
  const responseInit =
    typeof init === "number" ?
      { status: init } :
      init;
  const headers = new Headers(responseInit.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(JSON.stringify(body, null, 2), {
    ...responseInit,
    headers
  });
}

export function htmlResponse(
  html: string,
  init: ResponseInit | number = 200
): Response {
  const responseInit =
    typeof init === "number" ?
      { status: init } :
      init;
  const headers = new Headers(responseInit.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");

  return new Response(html, {
    ...responseInit,
    headers
  });
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Expected application/json request body");
  }

  return await request.json() as T;
}

export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
