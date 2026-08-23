import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { globSync } from "node:fs";
import { expect, it } from "vitest";

const projectRoot = new URL("..", import.meta.url);
const output = new URL("../.vercel/output/", import.meta.url);

it("bundles restaurant credential modules into SSR output", () => {
  rmSync(output, { recursive: true, force: true });
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: projectRoot,
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
}, 20_000);

it("bundles tenant session imports into every SSR server function", () => {
  const serverSource = globSync("functions/**/_ssr/*.mjs", { cwd: output })
    .map((file) => readFileSync(new URL(file, output), "utf8"))
    .join("\n");

  expect(serverSource).not.toContain('import("./tenant-session.server")');
  expect(serverSource).not.toContain("@vite-ignore");
});
