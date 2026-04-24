const BASE64URL_PADDING = /=+$/u;
const BASE64URL_PLUS = /\+/gu;
const BASE64URL_SLASH = /\//gu;

export function base64UrlEncode(input: string | ArrayBuffer | Uint8Array): string {
  const bytes =
    typeof input === "string" ?
      new TextEncoder().encode(input) :
      input instanceof Uint8Array ?
        input :
        new Uint8Array(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(BASE64URL_PADDING, "")
    .replace(BASE64URL_PLUS, "-")
    .replace(BASE64URL_SLASH, "_");
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input)
    );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function importPkcs8Pem(
  pem: string,
  algorithm: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" },
  keyUsages: KeyUsage[] = ["sign"]
): Promise<CryptoKey> {
  const normalizedPem = pem.replace(/\\n/g, "\n");
  const base64 = normalizedPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/gu, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    algorithm,
    false,
    keyUsages
  );
}
