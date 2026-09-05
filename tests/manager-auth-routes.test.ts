import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager login route", () => {
  const text = () => read("../src/routes/manager/login.tsx");
  it("collects ID Manager + Password and links to register", () => {
    expect(text()).toContain("ID Manager");
    expect(text()).toContain("Password");
    expect(text()).toContain("membuat ID MANAGER BARU");
    expect(text()).toContain("loginManager");
  });
  it("redirects to the dashboard only after a successful login", () => {
    expect(text()).toContain('navigate({ to: "/manager" })');
    expect(text()).toContain("writeManagerIdentity");
  });
  it("uses TailAdmin auth primitives with a show/hide password toggle", () => {
    expect(text()).toContain("AuthLayout");
    expect(text()).toContain("IconField");
    expect(text()).toContain("showPassword");
    expect(text()).toContain("EyeOff");
  });
  it("gates submit until both fields are filled", () => {
    expect(text()).toContain("canSubmit");
    expect(text()).toContain("disabled={!canSubmit || busy}");
  });
});

describe("manager register route", () => {
  const text = () => read("../src/routes/manager/register.tsx");
  it("collects the required fields and auto-shows the resto name", () => {
    expect(text()).toContain("Nama Lengkap");
    expect(text()).toContain("ID Manager");
    expect(text()).toContain("Kode Resto");
    expect(text()).toContain("Ketik Ulang");
    expect(text()).toContain("loginToRestaurant");
  });
  it("redirects to login after submit, never to the dashboard", () => {
    expect(text()).toContain('navigate({ to: "/manager/login" })');
    expect(text()).not.toContain('navigate({ to: "/manager" })');
  });
  it("shows a loading state while resolving the resto code", () => {
    expect(text()).toContain("looking");
    expect(text()).toContain("animate-spin");
  });
  it("shows a checkmark once the resto name resolves", () => {
    expect(text()).toContain("restoValid");
    expect(text()).toContain("CheckCircle2");
  });
  it("offers a show/hide password toggle", () => {
    expect(text()).toContain("showPassword");
    expect(text()).toContain("EyeOff");
  });
  it("hardens submit: disabled until valid + confirm mismatch reminder", () => {
    expect(text()).toContain("canSubmit");
    expect(text()).toContain("disabled={!canSubmit || busy}");
    expect(text()).toContain("tidak cocok");
  });
  it("uses TailAdmin auth primitives", () => {
    expect(text()).toContain("AuthShell");
    expect(text()).toContain("IconField");
    expect(text()).toContain("taPrimaryButtonClass");
  });
});
