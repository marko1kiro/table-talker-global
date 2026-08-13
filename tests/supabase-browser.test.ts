import { expect, it } from "vitest";
import { getSupabaseBrowserClient } from "../src/lib/supabase-browser";

it("exports the lazy public Supabase client factory", () => {
  expect(getSupabaseBrowserClient).toBeTypeOf("function");
});
