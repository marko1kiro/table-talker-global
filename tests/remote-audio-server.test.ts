import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commandInputSchema, validateCommandRequest } from "../src/lib/remote-audio.server";

const serverPath = resolve(import.meta.dirname, "../src/lib/remote-audio.server.ts");

function server(): string {
  return readFileSync(serverPath, "utf8");
}

it("rejects invalid targets and non-catalog audio", () => {
  expect(
    validateCommandRequest({ targetSessionId: "bad", audioId: "table:7" }, ["table:7"]),
  ).toEqual({ error: "Target crew tidak valid." });
  expect(
    validateCommandRequest(
      {
        targetSessionId: "d2719c7e-5b88-4ee3-8a45-7c95305a3023",
        audioId: "announcement:missing",
      },
      ["table:7"],
    ),
  ).toEqual({ error: "Audio tidak tersedia." });
});

it("rejects malformed command payloads before availability checks", () => {
  expect(commandInputSchema.safeParse({}).success).toBe(false);
  expect(commandInputSchema.safeParse({ targetSessionId: 1, audioId: "table:7" }).success).toBe(
    false,
  );
});

it("uses the authoritative command RPC without a direct command insert", () => {
  expect(server()).toMatch(/client\.rpc\("create_remote_command", \{/);
  expect(server()).not.toMatch(/from\("remote_commands"\)\s*\.insert/);
});

it("maps snapshot sessions through online/recent filtering before returning them", () => {
  expect(server()).toContain("classifyCrewSession");
  expect(server()).toContain('state === "expired"');
  expect(server()).toContain("state,");
});

it("maps stale targets to availability and other RPC failures offline", () => {
  expect(server()).toMatch(/TARGET_NOT_ELIGIBLE[\s\S]*Crew tidak sedang siap menerima audio\./);
  expect(server()).toMatch(/return error \? offline\(\) : \{ ok: true as const \}/);
});
