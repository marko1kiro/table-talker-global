// Manager passwords are hashed with node:crypto scrypt (no new dependency).
// Stored format: "<saltHex(32)>:<hashHex(128)>" (16-byte salt, 64-byte key).
// Dynamic import of node:crypto keeps this module safe to import from a
// *.server.ts that a client route also pulls in (see role-session.server.ts).
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    void import("node:crypto").then(({ scrypt: scryptFn }) => {
      scryptFn(password, salt, KEY_BYTES, (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      });
    }, reject);
  });
}

export async function hashManagerPassword(password: string): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyManagerPassword(password: string, stored: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}
