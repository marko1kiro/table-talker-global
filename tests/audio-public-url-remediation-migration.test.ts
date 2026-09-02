import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260902210000_remediate_audio_public_urls.sql",
  import.meta.url,
);
const source = () => readFileSync(migrationUrl, "utf8").toLowerCase();

const oldPrefix = "https://pub-b2b476c3360c4559bfc048819136744f.r2.dev/";
const newPrefix = "https://static.lihatmeja.com/";

describe("audio public URL remediation migration", () => {
  it("rewrites only the retired R2 origin while preserving each object path", () => {
    const sql = source();

    expect(sql).toContain("update public.audio_manifests");
    expect(sql).toContain(`'${oldPrefix}'`);
    expect(sql).toContain(`'${newPrefix}'`);
    expect(sql).toMatch(/set r2_url\s*=\s*v_new_prefix\s*\|\|\s*substr\(/);
    expect(sql).toMatch(/where left\(r2_url, length\(v_old_prefix\)\) = v_old_prefix/);
    expect(sql).not.toContain("delete from public.audio_manifests");
  });
});
