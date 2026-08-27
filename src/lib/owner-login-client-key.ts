const OWNER_LOGIN_CLIENT_KEY = "table-talker-owner-login-client-key";
let fallbackClientKey: string | null = null;

export function getOwnerLoginClientKey(storage: Storage = localStorage) {
  try {
    const existing = storage.getItem(OWNER_LOGIN_CLIENT_KEY);
    if (existing && existing.length >= 16 && existing.length <= 200) return existing;
    const clientKey = `owner-${crypto.randomUUID()}`;
    storage.setItem(OWNER_LOGIN_CLIENT_KEY, clientKey);
    return clientKey;
  } catch {
    fallbackClientKey ??= `owner-${crypto.randomUUID()}`;
    return fallbackClientKey;
  }
}
