import { loadEnv, mergeConfig, defineConfig as viteDefineConfig, type UserConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

// The previous build-config wrapper was removed from this repo; the plugin
// stack and root config below replicate its non-sandbox behavior exactly
// (verified against the wrapper's dist/index.js of 2.7.6): devtools (dev-only,
// first), tailwindcss, tsConfigPaths, tanstackStart (importProtection),
// nitro (build-only, user options), viteReact, plus env define, lightningcss,
// the "@" alias, React/TanStack dedupe, optimizeDeps, and host/port/watch
// defaults. Sandbox-only plugins (assets proxy, HMR gate, dev-server bridge,
// build diagnostics) were never used outside that hosted editor and are not
// replicated.

const nitroOptions = {
  preset: "vercel",
  plugins: ["./src/plugins/auth-startup.ts"],
};

const tanstackStartOptions = mergeConfig(
  {
    importProtection: {
      behavior: "error",
      client: {
        files: ["**/server/**"],
        specifiers: ["server-only"],
      },
    },
  },
  {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
);

export default viteDefineConfig((env) => {
  const { command, mode } = env;
  const isDevBuild = command === "build" && mode === "development";

  const plugins: UserConfig["plugins"] = [];
  if (mode === "development") {
    plugins.push(
      devtools({
        logging: false,
        eventBusConfig: { enabled: false },
        enhancedLogs: { enabled: false },
        consolePiping: { enabled: false },
        removeDevtoolsOnBuild: false,
        injectSource: { enabled: true },
      }),
    );
  }
  plugins.push(
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(tanstackStartOptions),
  );
  if (command === "build") plugins.push(nitro(nitroOptions));
  plugins.push(viteReact());

  const envDefine: Record<string, string> = {};
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  let config: UserConfig & { esbuild?: { keepNames?: boolean } } = {
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      ignoreOutdatedRequests: true,
    },
    plugins,
  };

  config = mergeConfig(
    {
      server: {
        host: "::",
        port: 8080,
        watch: {
          awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
        },
      },
    },
    config,
  );
  return config;
});
