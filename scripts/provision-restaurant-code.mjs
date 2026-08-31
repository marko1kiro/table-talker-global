import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Kode Resto is stored as PLAIN TEXT (user decision, 2026-08-31). This
// script previously derived an HMAC lookup hash and an AES-256-GCM
// ciphertext in-process before calling rotate_restaurant_credentials; that
// crypto (and its master encryption-key env var) is gone. The secure
// stdin/file input plumbing (never argv, never shell history) is kept: the
// restaurant code is still an access credential even though it is now
// stored in plain text server-side.

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
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
  if (!/^[A-Z0-9-]{6,32}$/.test(code)) throw new Error("INVALID_INPUT");

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

  const { error } = await client.rpc("rotate_restaurant_credentials", {
    p_restaurant_id: restaurant.id,
    p_code: code,
    p_next_code_version: restaurant.code_version + 1,
  });
  if (error) throw new Error("PROVISIONING_FAILED");
  const { data: readback, error: readbackError } = await client
    .from("restaurants")
    .select("id, code")
    .eq("id", restaurant.id)
    .single();
  if (readbackError || !readback || readback.code !== code) throw new Error("READBACK_FAILED");
  process.stdout.write(
    `Provisioned credential for ${restaurant.display_name} (${restaurant.id}).\n`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : "PROVISIONING_FAILED"));
