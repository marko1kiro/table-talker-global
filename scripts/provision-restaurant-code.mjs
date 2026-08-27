import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseKey(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value ?? "")) throw new Error("INVALID_KEY");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) throw new Error("INVALID_KEY");
  return key;
}

function deriveKey(key, purpose) {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(purpose), 32));
}

function hashRestaurantCode(code, key) {
  return `hmac-sha256:v1:${createHmac(
    "sha256",
    deriveKey(key, "table-talker/restaurant-code-lookup/v1"),
  )
    .update(code)
    .digest("base64url")}`;
}

function encryptRestaurantCode(code, restaurantId, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(key, "table-talker/restaurant-code-encryption/v1"),
    nonce,
  );
  cipher.setAAD(Buffer.from(`restaurant_id:${restaurantId};format:aes-256-gcm:v1`));
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `aes-256-gcm:v1:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`;
}

function decryptRestaurantCode(value, restaurantId, key) {
  const [, , nonceValue, ciphertextValue, tagValue] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(key, "table-talker/restaurant-code-encryption/v1"),
    Buffer.from(nonceValue, "base64url"),
  );
  decipher.setAAD(Buffer.from(`restaurant_id:${restaurantId};format:aes-256-gcm:v1`));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function isInside(path, directory) {
  const pathRelative = relative(directory, path);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function readCodeFile(codeFile) {
  const file = realpathSync(codeFile);
  if (process.platform === "win32") {
    const approvedDirectories = [realpathSync(tmpdir()), realpathSync(homedir())];
    if (!approvedDirectories.some((directory) => isInside(file, directory)))
      throw new Error("INSECURE_CODE_FILE");
    let owner;
    let acl;
    try {
      owner = execFileSync("icacls", [file, "/getowner"], {
        encoding: "utf8",
        windowsHide: true,
      });
      acl = execFileSync("icacls", [file], { encoding: "utf8", windowsHide: true });
    } catch {
      throw new Error("INSECURE_CODE_FILE");
    }
    const username = process.env.USERNAME;
    if (
      !username ||
      !owner
        .toLowerCase()
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim().startsWith("owner ") && line.trim().endsWith(`\\${username.toLowerCase()}`),
        )
    )
      throw new Error("INSECURE_CODE_FILE");
    if (
      /^(?:.*\s)?(?:Everyone|BUILTIN\\Users|Authenticated Users|Users):(?:\([^)]*\))*\((?:F|M|RX|R|W)\)/im.test(
        acl,
      )
    )
      throw new Error("INSECURE_CODE_FILE");
  } else if (statSync(file).mode & 0o077) {
    throw new Error("INSECURE_CODE_FILE");
  }
  return readFileSync(file, "utf8").replace(/\r?\n$/, "");
}

async function readCodeStdin() {
  if (process.stdin.isTTY) throw new Error("INVALID_INPUT");
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input.replace(/\r?\n$/, "");
}

async function main() {
  const restaurantId = option("--restaurant-id");
  const codeFile = option("--code-file") ?? process.env.RESTAURANT_CODE_FILE;
  const codeStdin = process.argv.includes("--code-stdin");
  if (!restaurantId || !/^[0-9a-f-]{36}$/i.test(restaurantId) || codeStdin === Boolean(codeFile))
    throw new Error("INVALID_INPUT");
  const code = codeStdin ? await readCodeStdin() : readCodeFile(codeFile);
  if (!/^[A-Z0-9]{6,32}$/.test(code)) throw new Error("INVALID_INPUT");

  const key = parseKey(process.env.RESTAURANT_CODE_ENCRYPTION_KEY ?? "");
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("MISSING_SERVER_CONFIGURATION");
  const client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: restaurant, error: lookupError } = await client
    .from("restaurants")
    .select("id, display_name, code_version")
    .eq("id", restaurantId)
    .maybeSingle();
  if (lookupError || !restaurant) throw new Error("RESTAURANT_NOT_FOUND");

  const codeHash = hashRestaurantCode(code, key);
  const codeEncrypted = encryptRestaurantCode(code, restaurant.id, key);
  const { error } = await client.rpc("rotate_restaurant_credentials", {
    p_restaurant_id: restaurant.id,
    p_code_hash: codeHash,
    p_code_encrypted: codeEncrypted,
    p_next_code_version: restaurant.code_version + 1,
  });
  if (error) throw new Error("PROVISIONING_FAILED");
  const { data: readback, error: readbackError } = await client
    .from("restaurants")
    .select("id, code_hash, code_encrypted")
    .eq("id", restaurant.id)
    .single();
  if (
    readbackError ||
    !readback ||
    readback.code_hash !== codeHash ||
    decryptRestaurantCode(readback.code_encrypted, restaurant.id, key) !== code
  )
    throw new Error("READBACK_FAILED");
  process.stdout.write(
    `Provisioned credential for ${restaurant.display_name} (${restaurant.id}).\n`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : "PROVISIONING_FAILED"));
