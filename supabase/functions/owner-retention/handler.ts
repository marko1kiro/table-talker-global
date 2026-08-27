export type OwnerRetentionConfig = { url: string; serviceRoleKey: string };
export type OwnerRetentionResult = { data?: unknown; error?: unknown };
type Digest = (value: string) => Promise<Uint8Array>;

type Dependencies = {
  config: OwnerRetentionConfig;
  runOwnerRetention: (signal: AbortSignal) => Promise<OwnerRetentionResult>;
  digest?: Digest | null;
};

const encoder = new TextEncoder();

async function defaultDigest(value: string) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(hash);
}

async function hasValidAuthorization(
  authorization: string | null,
  serviceRoleKey: string,
  digest: Digest | null,
) {
  if (!authorization || !serviceRoleKey) return false;

  const expected = `Bearer ${serviceRoleKey}`;
  if (digest) {
    const [actual, expectedBytes] = await Promise.all([digest(authorization), digest(expected)]);
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1)
      difference |= actual[index] ^ expectedBytes[index];
    return difference === 0;
  }

  let difference = authorization.length ^ expected.length;
  const length = Math.max(authorization.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (authorization.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isAbort(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : undefined;
  const message =
    error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.startsWith("AbortError:");
}

export function createOwnerRetentionHandler({ config, digest, runOwnerRetention }: Dependencies) {
  const authorizationDigest =
    digest === undefined ? (globalThis.crypto?.subtle ? defaultDigest : null) : digest;
  return async (request: Request) => {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (
      !config.url ||
      !config.serviceRoleKey ||
      !(await hasValidAuthorization(
        request.headers.get("authorization"),
        config.serviceRoleKey,
        authorizationDigest,
      ))
    ) {
      return new Response("unauthorized", { status: 401 });
    }

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 8_000);
    try {
      const result = await runOwnerRetention(controller.signal);
      if (controller.signal.aborted || isAbort(result.error)) {
        return new Response("cleanup timed out", { status: 504 });
      }
      if (result.error) return new Response("cleanup failed", { status: 500 });
      return Response.json(result.data, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted)
        return new Response("cleanup timed out", { status: 504 });
      console.error("owner retention request failed");
      return new Response("cleanup failed", { status: 500 });
    } finally {
      clearTimeout(deadline);
    }
  };
}
