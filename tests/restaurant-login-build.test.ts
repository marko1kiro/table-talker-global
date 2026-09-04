import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { globSync } from "node:fs";
import { expect, it } from "vitest";

const projectRoot = new URL("..", import.meta.url);
const output = new URL("../.vercel/output/", import.meta.url);

it("bundles restaurant credential modules into SSR output", () => {
  rmSync(output, { recursive: true, force: true });
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "pipe",
  });

  expect(existsSync(output)).toBe(true);
  const serverSource = globSync("functions/**/_ssr/restaurants.server-*.mjs", {
    cwd: output,
  })
    .map((file) => readFileSync(new URL(file, output), "utf8"))
    .join("\n");
  const clientSource = globSync("static/assets/*.js", { cwd: output })
    .map((file) => readFileSync(new URL(file, output), "utf8"))
    .join("\n");

  expect(serverSource).not.toContain('import("./restaurant-code.server")');
  expect(serverSource).not.toContain('import("./restaurant-session.server")');
  expect(serverSource).not.toContain("@vite-ignore");
  expect(clientSource).not.toContain("node:crypto");
}, 60_000);

it("fails at production function startup when AUTH_SECRET is missing", () => {
  const entry = new URL("functions/__server.func/index.mjs", output);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.AUTH_SECRET;

  const startup = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(entry.href)})`],
    { cwd: projectRoot, env, encoding: "utf8" },
  );

  expect(startup.status).not.toBe(0);
  expect(`${startup.stdout}\n${startup.stderr}`).toMatch(/AUTH_SECRET/);
});

it("returns a safe 503 from built health handling if auth becomes invalid", () => {
  const entry = new URL("functions/__server.func/index.mjs", output);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    AUTH_SECRET: "a".repeat(32),
  };
  const script = `
    const server = (await import(${JSON.stringify(entry.href)})).default;
    process.env.AUTH_SECRET = "too-short";
    const response = await server.fetch(new Request("https://lime.example/api/health"));
    console.log(JSON.stringify({
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: await response.json(),
    }));
  `;

  const health = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
  });

  expect(health.status).toBe(0);
  expect(JSON.parse(health.stdout.trim())).toEqual({
    status: 503,
    cacheControl: "no-store",
    body: { ok: false, error: "SERVER_MISCONFIGURED" },
  });
});

it("bundles tenant session imports into every SSR server function", () => {
  const serverSource = globSync("functions/**/_ssr/*.mjs", { cwd: output })
    .map((file) => readFileSync(new URL(file, output), "utf8"))
    .join("\n");

  expect(serverSource).not.toContain('import("./tenant-session.server")');
  expect(serverSource).not.toContain("@vite-ignore");
});
