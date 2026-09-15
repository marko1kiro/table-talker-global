// @vitest-environment jsdom
// Poin 6.1 S4: the email-first machine on REAL components. Asserts: routing by
// crewLoginMethod verdict, the mandatory setPassword gate on EVERY OTP entry,
// the fresh pairing field, no "Sudah punya kode?" button, in-place retry for
// transient post-login failures, and busy-disabled submits (owner rule).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const crewLoginMethod = vi.fn();
const crewMe = vi.fn();
const crewValidateCode = vi.fn();
const crewRequestPairing = vi.fn();
const crewConfirmPairing = vi.fn();
const crewClaimShift = vi.fn();
const crewSignInWithOtp = vi.fn();
const crewVerifyOtp = vi.fn();
const crewSignInWithPassword = vi.fn();
const crewSetPassword = vi.fn();
const refreshCarrierToken = vi.fn();
const getDeviceToken = vi.fn();
const crewSignOut = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m) } }));
vi.mock("@/lib/crew-auth.server", () => ({
  crewLoginMethod: (a: { data: { email: string } }) => crewLoginMethod(a),
  crewMe: (a: unknown) => crewMe(a),
  crewValidateCode: (a: unknown) => crewValidateCode(a),
  crewRequestPairing: (a: unknown) => crewRequestPairing(a),
  crewConfirmPairing: (a: unknown) => crewConfirmPairing(a),
  crewClaimShift: (a: unknown) => crewClaimShift(a),
}));
vi.mock("@/lib/browser-auth", () => ({
  crewSignInWithOtp: (email: string) => crewSignInWithOtp(email),
  crewVerifyOtp: (email: string, otp: string) => crewVerifyOtp(email, otp),
  crewSignInWithPassword: (email: string, password: string) =>
    crewSignInWithPassword(email, password),
  crewSetPassword: (password: string) => crewSetPassword(password),
  crewSignOut: () => crewSignOut(),
  refreshCarrierToken: () => refreshCarrierToken(),
  getDeviceToken: () => getDeviceToken(),
}));

import { CrewLoginFlow } from "../src/components/CrewLoginFlow";

const REST = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const DEVICE = "11111111-2222-4222-8222-333333333333";
const EMAIL = "budi@example.com";

const okMeUnpaired = {
  ok: true,
  paired: false,
  status: null,
  fullName: null,
  restaurantId: null,
  restaurantName: null,
  deviceCurrent: false,
};
const okMePaired = {
  ok: true,
  paired: true,
  status: "aktif",
  fullName: "Budi",
  restaurantId: REST,
  restaurantName: "RMuji",
  deviceCurrent: true,
};

beforeEach(() => {
  crewLoginMethod.mockReset().mockResolvedValue({ ok: true, method: "otp" });
  crewMe.mockReset().mockResolvedValue(okMePaired);
  crewValidateCode.mockReset();
  crewRequestPairing.mockReset();
  crewConfirmPairing.mockReset();
  crewClaimShift.mockReset();
  crewSignInWithOtp.mockReset().mockResolvedValue({ ok: true });
  crewVerifyOtp.mockReset().mockResolvedValue({ ok: true });
  crewSignInWithPassword.mockReset().mockResolvedValue({ ok: true });
  crewSetPassword.mockReset().mockResolvedValue({ ok: true });
  // Boot default: NO persisted session — the flow must land on the email step.
  refreshCarrierToken.mockReset().mockResolvedValue(null);
  getDeviceToken.mockReset().mockReturnValue(DEVICE);
  crewSignOut.mockReset();
  toastSuccess.mockReset();
});

afterEach(cleanup);

function flow() {
  return render(
    <CrewLoginFlow
      onSsContinue={vi.fn()}
      onRoleContinue={vi.fn()}
      resendCooldownMs={0}
      sessionRetryMs={0}
    />,
  );
}

async function submitEmail() {
  await flow();
  await waitFor(() => expect(screen.getByLabelText("Email")).not.toBeNull());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /Lanjut/i }));
}

// From here on the browser has a live GoTrue session; every helper that
// crosses a login boundary flips this FIRST so sessionAndDevice() succeeds.
function liveSession() {
  refreshCarrierToken.mockResolvedValue("jwt-1");
}

async function passOtpVerification() {
  await waitFor(() => expect(screen.getByLabelText("Kode email")).not.toBeNull());
  fireEvent.change(screen.getByLabelText("Kode email"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: /Verifikasi/i }));
}

async function passSetPasswordGate() {
  await waitFor(() => expect(screen.getByLabelText("Password baru")).not.toBeNull());
  fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: "rahasia1" } });
  fireEvent.change(screen.getByLabelText("Ulangi password"), { target: { value: "rahasia1" } });
  liveSession();
  fireEvent.click(screen.getByRole("button", { name: /Simpan Password/i }));
}

describe("routing by verdict", () => {
  it("method=password shows the password screen (and crewLoginMethod got the email)", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    await submitEmail();
    expect(crewLoginMethod).toHaveBeenCalledWith({ data: { email: EMAIL } });
    await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeNull());
    expect(crewSignInWithOtp).not.toHaveBeenCalled();
  });

  it("password ok lands on checkin without touching setPassword", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "rahasia1" } });
    liveSession();
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Kasir/i })).not.toBeNull());
    expect(crewSetPassword).not.toHaveBeenCalled();
  });

  it("password screen shows lupa link BEFORE any attempt (escape hatch)", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeNull());
    const lupa = screen.getByRole("button", { name: /kirim kode email/i });
    expect((lupa as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(lupa);
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL));
    await waitFor(() => expect(screen.getByLabelText("Kode email")).not.toBeNull());
  });

  it("wrong password => neutral copy + lupa link, no OTP yet", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    crewSignInWithPassword.mockResolvedValueOnce({ ok: false, code: "INVALID_CREDENTIALS" });
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "salah" } });
    fireEvent.click(screen.getByRole("button", { name: "Masuk" }));
    await waitFor(() => expect(screen.getByText("Email atau password salah.")).not.toBeNull());
    expect(crewSignInWithOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /kirim kode email/i }));
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL));
  });
});

describe("OTP gate leads to setPassword everywhere", () => {
  it("new email: verify then setPassword then resto step", async () => {
    crewMe.mockResolvedValue(okMeUnpaired);
    await submitEmail();
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL));
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(crewSetPassword).toHaveBeenCalledWith("rahasia1"));
    expect(toastSuccess).toHaveBeenCalledWith("Password tersimpan");
    await waitFor(() => expect(screen.getByLabelText("Kode Resto")).not.toBeNull());
  });

  it("mismatched confirmation is refused locally (no network)", async () => {
    await submitEmail();
    await passOtpVerification();
    await waitFor(() => expect(screen.getByLabelText("Password baru")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: "rahasia1" } });
    fireEvent.change(screen.getByLabelText("Ulangi password"), { target: { value: "lain123" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan Password/i }));
    expect(crewSetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/belum sama/i)).not.toBeNull();
  });

  it("paired old crew: setPassword gate BEFORE checkin (owner rule)", async () => {
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(screen.getByRole("button", { name: /Kasir/i })).not.toBeNull());
  });
});

describe("pairing screen fixes", () => {
  it("waiting shows the manager-code input immediately, EMPTY, no extra button", async () => {
    crewMe.mockResolvedValue(okMeUnpaired);
    crewValidateCode.mockResolvedValue({
      ok: true,
      restaurantId: REST,
      displayName: "RMuji",
    });
    crewRequestPairing.mockResolvedValue({
      ok: true,
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    });
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(screen.getByLabelText("Kode Resto")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText("Kode Resto"), { target: { value: "GACOAN" } });
    fireEvent.click(screen.getByRole("button", { name: /Cek Kode/i }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Lanjutkan/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lanjutkan/i }));
    await waitFor(() => expect(screen.getByLabelText(/kode dari manager/i)).not.toBeNull());
    expect((screen.getByLabelText(/kode dari manager/i) as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/sudah punya kode/i)).toBeNull();
  });
});

describe("in-place retry replaces the email-loop bug", () => {
  it("transient crew_me failure keeps the session and offers Coba lagi", async () => {
    crewMe.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE", message: "x" });
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(screen.getByText(/Gagal memuat data/i)).not.toBeNull());
    expect(screen.queryByLabelText("Email")).toBeNull();
    crewMe.mockResolvedValueOnce(okMePaired);
    fireEvent.click(screen.getByRole("button", { name: /Coba lagi/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Kasir/i })).not.toBeNull());
  });
});

describe("boot transient never dead-ends", () => {
  it("boot crewMe UNAVAILABLE shows alert+retry, retry lands checkin", async () => {
    refreshCarrierToken.mockResolvedValue("jwt-1");
    crewMe
      .mockReset()
      .mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE", message: "x" })
      .mockResolvedValue(okMePaired);
    flow();
    await waitFor(() => expect(screen.getByText(/Gagal memuat data/i)).not.toBeNull());
    const btn = screen.getByRole("button", { name: /Coba lagi/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("button", { name: /Kasir/i })).not.toBeNull());
  });
});

describe("busy-disable rule (owner: one click, buttons lock)", () => {
  it("Verifikasi button is disabled while the network call is in flight", async () => {
    let resolveVerify: (v: { ok: boolean }) => void = () => {};
    crewVerifyOtp.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveVerify = r;
        }),
    );
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Kode email")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Kode email"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verifikasi/i }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Verifikasi/i }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    resolveVerify({ ok: true });
  });
});
