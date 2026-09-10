// R6-E: self-contained PostgREST harness for HTTP evidence.
// - The binary is pinned to v16.2 and verified against the SHA-256 digests
//   published on the PostgREST GitHub release (queried from the release's
//   own `digest` fields) BEFORE anything is executed. A corrupted or
//   substituted download never runs.
// - JWTs are real HMAC-SHA256 (PostgREST's expected HS256).
// - The HTTP port is dynamically allocated; the DB port comes from the
//   shared disposable-DB harness (embedded PG locally, service container
//   in CI via TEST_DATABASE_URL).
// - Extraction uses the system `tar` (bsdtar on Windows, GNU tar + xz on
//   ubuntu-latest) so no extra dependency is introduced.
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PGRST_VERSION = "v16.2";
const BASE = `https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}`;

// Digests copied from the GitHub release assets (api /releases/tags/v16.2).
const ASSETS: Record<string, { file: string; sha256: string; exe: string }> = {
  linux: {
    file: "postgrest-v16.2-linux-static-x86-64.tar.xz",
    sha256: "4712595baae0f5d84a527d55a11166d6bf4d9b0f1d102505c5e9d59219787f08",
    exe: "postgrest",
  },
  darwin: {
    file: "postgrest-v16.2-macos-x86-64.tar.xz",
    sha256: "b69938d92a6a73a56732038bbc37383eeb26d6e554dba66d6a0410a96a493cda",
    exe: "postgrest",
  },
  win32: {
    file: "postgrest-v16.2-windows-x86-64.zip",
    sha256: "f27c3fd12bb6f3a2ff6f7b3283d4fe63ef2a74f718c030cdd387f768ceb15ab9",
    exe: "postgrest.exe",
  },
};

export type PostgrestHandle = {
  url: string;
  jwt: (claims: Record<string, unknown>) => string;
  /** JWT signed with a DIFFERENT secret — must be rejected (401). */
  forgeJwt: (claims: Record<string, unknown>) => string;
  stop: () => Promise<void>;
};

async function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
    srv.on("error", reject);
  });
}

function platformAsset() {
  const asset = ASSETS[process.platform];
  if (!asset) throw new Error(`unsupported platform for PostgREST evidence: ${process.platform}`);
  return asset;
}

async function ensureBinary(): Promise<string> {
  const asset = platformAsset();
  // Fresh dir per PROCESS run: a pre-planted binary in a shared tmpdir can
  // never be executed — the archive is digest-verified before extraction and
  // the whole dir is removed by stop().
  const dir = path.join(os.tmpdir(), `postgrest-r6-evidence-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });

  const archive = path.join(dir, asset.file);
  {
    const res = await fetch(`${BASE}/${asset.file}`);
    if (!res.ok || !res.body) {
      throw new Error(`download failed: ${res.status} for ${BASE}/${asset.file}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(archive, buf);
  }
  const actual = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  if (actual !== asset.sha256) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `PostgREST digest mismatch: expected ${asset.sha256}, got ${actual} — refusing to execute`,
    );
  }
  // bsdtar (Windows) extracts .zip; GNU tar (ubuntu) extracts .tar.xz.
  execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "pipe" });
  const exe = path.join(dir, asset.exe);
  if (!fs.existsSync(exe)) throw new Error(`archive did not contain ${asset.exe}`);
  if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
  return exe;
}

function signJwt(secret: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** Boots PostgREST against an ALREADY-MIGRATED disposable database and waits
 * until it serves requests. The connection string comes from createTestDb. */
export async function startPostgrestHarness(connectionString: string): Promise<PostgrestHandle> {
  const exe = await ensureBinary();
  const dir = path.dirname(exe);
  const port = await freeTcpPort();
  const secret = randomBytes(32).toString("hex");
  const configPath = path.join(dir, `r6e-${Date.now()}-${port}.conf`);
  fs.writeFileSync(
    configPath,
    [
      // v16 config parser requires quoted string values.
      `db-uri = "${connectionString}"`,
      'db-schemas = "public"',
      'db-anon-role = "anon"',
      `jwt-secret = "${secret}"`,
      `server-port = ${port}`,
      'server-host = "127.0.0.1"',
    ].join("\n"),
    { mode: 0o600 },
  );

  // Capture stderr: a config-parse/startup failure surfaces verbatim instead
  // of a bare "exited early with code 1".
  let stderr = "";
  const child = spawn(exe, [configPath], { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  try {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) {
        throw new Error(
          `postgrest exited early with code ${child.exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
        );
      }
      try {
        const res = await fetch(`${url}/`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      child.kill();
      throw new Error(
        `postgrest did not become ready within 30s${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    }
  } catch (error) {
    fs.rmSync(configPath, { force: true });
    throw error;
  }

  return {
    url,
    jwt: (claims) => signJwt(secret, claims),
    forgeJwt: (claims) => signJwt(randomBytes(32).toString("hex"), claims),
    stop: async () => {
      child.kill();
      fs.rmSync(configPath, { force: true });
      fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
    },
  };
}
