// Poin 6 S3 contract: occupancy/manager snapshot READ paths must not ride
// Vercel server functions any more — the browser calls the authenticated RPC
// directly through the supabase-js singleton (Task 4 keeps its token fresh).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const READERS = [
  "src/routes/kasir/index.tsx",
  "src/routes/satgas/index.tsx",
  "src/routes/clear-up/index.tsx",
  "src/routes/manager/index.tsx",
];

describe("Poin 6 S3: snapshot reads are browser-direct", () => {
  it.each(READERS)("%s calls the snapshot core with a browser rpc, not the server fn", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("getSupabaseBrowserClient");
    expect(source).toMatch(/getTableOccupancySnapshotCore|getManagerSnapshotCore/);
    expect(source).not.toMatch(/\bgetTableOccupancySnapshot\(/);
    expect(source).not.toMatch(/\bgetManagerSnapshot\(/);
  });
});
