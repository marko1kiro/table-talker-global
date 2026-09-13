// @vitest-environment jsdom
// Poin 3 Task 8 (spec §3.2/§7): CrewLoginFlow state-machine runtime evidence.
// The REAL component runs in jsdom against mocked Task 6 server fns + Task 7
// browser-auth; every transition, error copy and the final identity payload
// handed to the existing onSsContinue/onRoleContinue contract are asserted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const crewMe = vi.fn();
const crewValidateCode = vi.fn();
const crewRequestPairing = vi.fn();
const crewConfirmPairing = vi.fn();
const crewClaimShift = vi.fn();
const crewSignInWithOtp = vi.fn();
const crewVerifyOtp = vi.fn();
const refreshCarrierToken = vi.fn();
const getDeviceToken = vi.fn();

vi.mock("@/lib/crew-auth.server", () => ({
  crewMe: (a: unknown) => crewMe(a),
  crewValidateCode: (a: unknown) => crewValidateCode(a),
  crewRequestPairing: (a: unknown) => crewRequestPairing(a),
  crewConfirmPairing: (a: unknown) => crewConfirmPairing(a),
  crewClaimShift: (a: unknown) => crewClaimShift(a),
}));
vi.mock("@/lib/browser-auth", () => ({
  crewSignInWithOtp: (email: string) => crewSignInWithOtp(email),
  crewVerifyOtp: (email: string, otp: string) => crewVerifyOtp(email, otp),
  refreshCarrierToken: () => refreshCarrierToken(),
  getDeviceToken: () => getDeviceToken(),
}));

import { CrewLoginFlow, PAIRING_WINDOW_MS } from "../src/components/CrewLoginFlow";

const REST = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const DEVICE = "11111111-2222-4222-8222-333333333333";
const EMAIL = "budi@example.com";

const okMe = (over: Record<string, unknown> = {}) => ({
  ok: true,
  paired: false,
  status: null,
  fullName: null,
  restaurantId: null,
  restaurantName: null,
  deviceCurrent: false,
  ...over,
});
const pairedMe = (over: Record<string, unknown> = {}) =>
  okMe({
    paired: true,
    status: "aktif",
    fullName: "Budi",
    restaurantId: REST,
    restaurantName: "RMuji",
    deviceCurrent: true,
    ...over,
  });

const okClaim = {
  ok: true,
  sessionId: "sess-1",
  role: "kasir",
  displayName: "Budi",
  checkedInAt: "2026-09-13T03:00:00.000Z",
  sessionToken: "role-tok",
  tenantToken: "tenant-tok",
  restaurantId: REST,
  restaurantName: "RMuji",
  restaurantCode: "RM01",
};

function renderFlow() {
  const onSsContinue = vi.fn();
  const onRoleContinue = vi.fn();
  render(<CrewLoginFlow onSsContinue={onSsContinue} onRoleContinue={onRoleContinue} />);
  return { onSsContinue, onRoleContinue };
}

async function submitField(label: string, value: string, buttonName: RegExp) {
  // findBy: boot's session routing is async, the target input may not be
  // committed yet right after render().
  fireEvent.change(await screen.findByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  await waitFor(() => expect(screen.queryByText("Memproses...")).toBeNull());
}

beforeEach(() => {
  // Module-level vi.fn mocks PERSIST across tests: reset first, then re-pin
  // defaults (leftover Once-queues/implementations from the previous test are
  // exactly the isolation bug this guards).
  for (const fn of [
    crewMe,
    crewValidateCode,
    crewRequestPairing,
    crewConfirmPairing,
    crewClaimShift,
    crewSignInWithOtp,
    crewVerifyOtp,
    refreshCarrierToken,
    getDeviceToken,
  ])
    fn.mockReset();
  getDeviceToken.mockReturnValue(DEVICE);
  // Blanket token: boot's crewMe must find UNPAIRED (default) to land on the
  // email step anyway; post-verify calls reuse the same fake for accessToken
  // forwarding assertions.
  refreshCarrierToken.mockResolvedValue("crew-jwt");
  crewMe.mockResolvedValue(okMe());
  crewSignInWithOtp.mockResolvedValue({ ok: true });
  crewVerifyOtp.mockResolvedValue({ ok: true });
  crewValidateCode.mockResolvedValue({ ok: true, restaurantId: REST, displayName: "RMuji" });
  crewRequestPairing.mockResolvedValue({ ok: true, requestId: REQUEST_ID });
  crewConfirmPairing.mockResolvedValue({ ok: true });
  crewClaimShift.mockResolvedValue(okClaim);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("boot", () => {
  it("unpaired session / no session -> email step; empty email cannot send", async () => {
    renderFlow();
    expect(await screen.findByLabelText(/email/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /kirim kode/i }));
    expect(crewSignInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/email/i).hasAttribute("required")).toBe(true);
  });

  it("paired + aktif + device-current -> straight to checkin (no email screen)", async () => {
    crewMe.mockResolvedValue(pairedMe());
    const { onRoleContinue } = renderFlow();
    expect(await screen.findByRole("button", { name: /^masuk$/i })).toBeTruthy();
    expect(crewMe).toHaveBeenCalledWith({
      data: { accessToken: "crew-jwt", deviceToken: DEVICE },
    });
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.getByText("RMuji")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /kasir/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    await waitFor(() => expect(crewClaimShift).toHaveBeenCalled());
    expect(crewClaimShift).toHaveBeenCalledWith({
      data: {
        accessToken: "crew-jwt",
        role: "kasir",
        checkedInAt: expect.any(String),
        deviceToken: DEVICE,
      },
    });
    expect(onRoleContinue).toHaveBeenCalledWith({
      restaurantId: REST,
      restaurantDisplayName: "RMuji",
      restaurantCode: "RM01",
      tenantToken: "tenant-tok",
      role: "kasir",
      displayName: "Budi",
      checkedInAt: "2026-09-13T03:00:00.000Z",
      roleSessionId: "sess-1",
      roleSessionToken: "role-tok",
      accessToken: "crew-jwt",
    });
  });

  it("paired but another device pinned -> kick screen; 'Lanjut di perangkat ini' -> checkin", async () => {
    crewMe.mockResolvedValue(pairedMe({ deviceCurrent: false }));
    renderFlow();
    expect(await screen.findByText("Akun ini dipakai login di perangkat lain.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /lanjut di perangkat ini/i }));
    expect(await screen.findByRole("button", { name: /^masuk$/i })).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it("paired but nonaktif -> disabled screen, no checkin affordance", async () => {
    crewMe.mockResolvedValue(pairedMe({ status: "nonaktif" }));
    renderFlow();
    expect(await screen.findByText(/dinonaktifkan/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^masuk$/i })).toBeNull();
  });
});

describe("email + otp screens", () => {
  it("send -> otp screen echoes the email; otp error shows the §7 message + resend", async () => {
    renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL);
    expect(await screen.findByText(EMAIL)).toBeTruthy();

    crewVerifyOtp.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));
    expect(
      await screen.findByText("Kode tidak sesuai atau kedaluwarsa. Minta kode baru."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /kirim ulang kode/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cek kode/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /kirim ulang kode/i }));
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledTimes(2));
  });

  it("provider failure on send maps to the §7 login-disabled message", async () => {
    crewSignInWithOtp.mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    expect(await screen.findByText("Sistem login sedang dimatikan. Hubungi Manager.")).toBeTruthy();
  });

  it("verify keeps busy pinned through routeSession; a second submit cannot re-enter", async () => {
    renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    // Hang routeSession's crewMe (post-boot => the verify call) to expose the
    // interactive window the busy-through-resolve fix is meant to close.
    let releaseMe: (v: unknown) => void = () => {};
    crewMe.mockImplementationOnce(() => new Promise((r) => (releaseMe = r)));
    fireEvent.change(screen.getByLabelText(/kode email/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));

    // crewMe is still in flight yet busy never dropped: spinner persists, so the
    // submit button is NOT re-enabled mid-route (the bug before the fix).
    expect(await screen.findByText("Memproses...")).toBeTruthy();
    // second submit during the in-flight hop
    fireEvent.click(screen.getByRole("button", { name: /memproses/i }));
    expect(crewVerifyOtp).toHaveBeenCalledTimes(1);
    // boot + one verify route = exactly two crewMe probes, no re-entry
    expect(crewMe).toHaveBeenCalledTimes(2);

    releaseMe(pairedMe());
    expect(await screen.findByRole("button", { name: /^masuk$/i })).toBeTruthy();
  });

  it("a token lost AFTER verification shows the unified SESSION_LOST copy, not PROVIDER_DOWN", async () => {
    renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    // boot used the blanket token; now the carrier JWT is gone before verify routes
    refreshCarrierToken.mockResolvedValue(null);
    fireEvent.change(screen.getByLabelText(/kode email/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));
    expect(await screen.findByText("Sesi login berakhir. Kirim kode lagi.")).toBeTruthy();
    expect(screen.queryByText("Sistem login sedang dimatikan. Hubungi Manager.")).toBeNull();
  });

  it("verified OTP on an ALREADY-paired email skips resto straight to checkin", async () => {
    refreshCarrierToken.mockResolvedValue("crew-jwt");
    crewMe.mockResolvedValueOnce(okMe({ paired: false })).mockResolvedValueOnce(pairedMe());
    renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));
    expect(await screen.findByRole("button", { name: /^masuk$/i })).toBeTruthy();
    expect(crewValidateCode).not.toHaveBeenCalled();
  });
});

describe("resto -> waiting -> pairing -> checkin happy path", () => {
  async function toResto() {
    const handlers = renderFlow();
    await submitField("Email", EMAIL, /kirim kode/i);
    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));
    await screen.findByLabelText(/nama/i);
    return handlers;
  }

  async function fillRestoAndCheck(name: string, resto = "RM01") {
    fireEvent.change(screen.getByLabelText(/nama/i), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/kode resto/i), { target: { value: resto } });
    fireEvent.click(screen.getByRole("button", { name: /cek kode/i }));
    await waitFor(() => expect(screen.queryByText("Memproses...")).toBeNull());
  }

  it("green resto check only after CEK KODE succeeds; LANJUTKAN then enters waiting with countdown", async () => {
    await toResto();
    expect(screen.queryByText("RMuji")).toBeNull();
    expect(crewRequestPairing).not.toHaveBeenCalled();

    await fillRestoAndCheck("Budi");
    expect(screen.getByText("RMuji")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/nama/i), { target: { value: "Budi Sant" } });
    fireEvent.click(screen.getByRole("button", { name: /lanjutkan/i }));
    expect(crewValidateCode).toHaveBeenCalledWith({
      data: { accessToken: "crew-jwt", code: "RM01" },
    });
    await waitFor(() =>
      expect(crewRequestPairing).toHaveBeenCalledWith({
        data: { accessToken: "crew-jwt", restaurantId: REST, fullName: "Budi Sant" },
      }),
    );
    expect(await screen.findByText("Hubungi Manager untuk mendapatkan kode aktifasi")).toBeTruthy();
    expect(screen.getByText(/550E8400/)).toBeTruthy();
    expect(screen.getByText(/^\d+:\d\d$/)).toBeTruthy();
  });

  it("double-tap LANJUTKAN fires exactly one crewRequestPairing (busy guard)", async () => {
    await toResto();
    await fillRestoAndCheck("Budi");
    await screen.findByText("RMuji");
    // Pin the pairing request in flight (never settles until released) so busy
    // stays true across the extra taps: this is the interactive window the
    // guard must close.
    let release: (v: unknown) => void = () => {};
    crewRequestPairing.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const lanjut = screen.getByRole("button", { name: /lanjutkan/i });
    fireEvent.click(lanjut);
    await waitFor(() => expect(crewRequestPairing).toHaveBeenCalledTimes(1));
    // button now reads "Mengirim..." (busy) — two more taps must no-op.
    fireEvent.click(screen.getByRole("button", { name: /mengirim/i }));
    fireEvent.click(screen.getByRole("button", { name: /mengirim/i }));
    expect(crewRequestPairing).toHaveBeenCalledTimes(1);
    release({ ok: true, requestId: REQUEST_ID });
    expect(await screen.findByText("Hubungi Manager untuk mendapatkan kode aktifasi")).toBeTruthy();
  });

  it("wrong resto code keeps LANJUTKAN unreachable and shows the server's generic message", async () => {
    crewValidateCode
      .mockResolvedValueOnce({
        ok: false,
        code: "INVALID_CODE",
        message: "Gagal memverifikasi kode resto.",
      })
      .mockResolvedValueOnce({ ok: true, restaurantId: REST, displayName: "RMuji" });
    await toResto();
    await fillRestoAndCheck("Budi");
    expect(await screen.findByText("Gagal memverifikasi kode resto.")).toBeTruthy();
    expect(screen.queryByText("RMuji")).toBeNull();
    // jest-dom matchers are not configured in this repo; use the DOM property.
    expect((screen.getByRole("button", { name: /lanjutkan/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("waiting -> pairing input: wrong OTP retries inline; EXPIRED shows the §7 restart screen", async () => {
    await toResto();
    await fillRestoAndCheck("Budi");
    await screen.findByText("RMuji");
    fireEvent.click(screen.getByRole("button", { name: /lanjutkan/i }));
    await screen.findByText("Hubungi Manager untuk mendapatkan kode aktifasi");

    fireEvent.click(screen.getByRole("button", { name: /sudah punya kode/i }));
    crewConfirmPairing
      .mockResolvedValueOnce({
        ok: false,
        code: "INVALID_OTP",
        message: "Gagal mengonfirmasi pairing.",
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "EXPIRED",
        message: "Gagal mengonfirmasi pairing.",
      });
    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /register device/i }));
    expect(await screen.findByText("Gagal mengonfirmasi pairing.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "888888" } });
    fireEvent.click(screen.getByRole("button", { name: /register device/i }));
    expect(await screen.findByText(/permintaan ditolak\/kedaluwarsa/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /minta kode baru|ulang/i }));
    await waitFor(() => expect(crewRequestPairing).toHaveBeenCalledTimes(2));
  });

  it("countdown expiring flips the waiting affordance to the restart action (fake timers)", async () => {
    // Fake timers BEFORE render: the waiting countdown interval must be
    // registered on the fake clock, otherwise advanceTimersByTime never
    // fires it (a real-clock interval is invisible to the mock).
    vi.useFakeTimers();
    const flush = async (ms = 50) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    renderFlow();
    await flush();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: /kirim kode/i }));
    await flush();
    fireEvent.change(screen.getByLabelText(/kode email/i), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verifikasi/i }));
    await flush();
    fireEvent.change(screen.getByLabelText(/nama/i), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText(/kode resto/i), { target: { value: "RM01" } });
    fireEvent.click(screen.getByRole("button", { name: /cek kode/i }));
    await flush();
    expect(screen.getByText("RMuji")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /lanjutkan/i }));
    await flush();
    expect(screen.getByText("Hubungi Manager untuk mendapatkan kode aktifasi")).toBeTruthy();
    await flush(PAIRING_WINDOW_MS + 1_000);
    expect(screen.getByText(/permintaan ditolak\/kedaluwarsa/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /minta kode baru/i }));
    await flush();
    expect(crewRequestPairing).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("confirm success -> checkin; SS role hands the legacy CrewSessionIdentity shape (Option B)", async () => {
    crewClaimShift.mockResolvedValue({ ...okClaim, role: "ss" });
    const { onSsContinue } = await toResto();
    await fillRestoAndCheck("Budi");
    await screen.findByText("RMuji");
    fireEvent.click(screen.getByRole("button", { name: /lanjutkan/i }));
    await screen.findByText("Hubungi Manager untuk mendapatkan kode aktifasi");
    fireEvent.click(screen.getByRole("button", { name: /sudah punya kode/i }));
    fireEvent.change(screen.getByLabelText(/kode/i), { target: { value: "123123" } });
    fireEvent.click(screen.getByRole("button", { name: /register device/i }));
    await screen.findByRole("button", { name: /^masuk$/i });
    expect(crewConfirmPairing).toHaveBeenCalledWith({
      data: { accessToken: "crew-jwt", requestId: REQUEST_ID, otp: "123123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^ss/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    await waitFor(() => expect(onSsContinue).toHaveBeenCalled());
    expect(onSsContinue).toHaveBeenCalledWith({
      displayName: "Budi",
      normalizedName: "budi",
      restaurantId: REST,
      restaurantDisplayName: "RMuji",
      tenantToken: "tenant-tok",
      crewSessionId: "",
      crewSessionToken: "",
    });
  });
});

describe("claim failure mapping", () => {
  it("NOT_PAIRED sends the crew back to the email step with the server message", async () => {
    refreshCarrierToken.mockResolvedValue("crew-jwt");
    crewMe.mockResolvedValue(pairedMe());
    crewClaimShift.mockResolvedValue({
      ok: false,
      code: "NOT_PAIRED",
      message: "Gagal memulai sesi kerja.",
    });
    renderFlow();
    await screen.findByRole("button", { name: /^masuk$/i });
    fireEvent.click(screen.getByRole("button", { name: /satgas/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    expect(await screen.findByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByText("Gagal memulai sesi kerja.")).toBeTruthy();
  });

  it("ACCOUNT_DISABLED lands on the disabled screen", async () => {
    refreshCarrierToken.mockResolvedValue("crew-jwt");
    crewMe.mockResolvedValue(pairedMe());
    crewClaimShift.mockResolvedValue({
      ok: false,
      code: "ACCOUNT_DISABLED",
      message: "Gagal memulai sesi kerja.",
    });
    renderFlow();
    await screen.findByRole("button", { name: /^masuk$/i });
    fireEvent.click(screen.getByRole("button", { name: /kasir/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    expect(await screen.findByText(/dinonaktifkan/i)).toBeTruthy();
  });

  it("network-failed claim gets exactly one silent retry and then succeeds (§7)", async () => {
    crewMe.mockResolvedValue(pairedMe());
    crewClaimShift
      .mockResolvedValueOnce({
        ok: false,
        code: "UNAVAILABLE",
        message: "Gagal memulai sesi kerja.",
      })
      .mockResolvedValueOnce(okClaim);
    const { onRoleContinue } = renderFlow();
    await screen.findByRole("button", { name: /^masuk$/i });
    fireEvent.click(screen.getByRole("button", { name: /kasir/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    await waitFor(() => expect(onRoleContinue).toHaveBeenCalled());
    expect(crewClaimShift).toHaveBeenCalledTimes(2);
    // Same payload both times: the shift clock must not drift on retry.
    expect(crewClaimShift.mock.calls[0]).toEqual(crewClaimShift.mock.calls[1]);
  });

  it("persistent UNAVAILABLE stops after the single retry with the generic inline error", async () => {
    crewMe.mockResolvedValue(pairedMe());
    crewClaimShift.mockResolvedValue({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memulai sesi kerja.",
    });
    renderFlow();
    await screen.findByRole("button", { name: /^masuk$/i });
    fireEvent.click(screen.getByRole("button", { name: /kasir/i }));
    fireEvent.click(screen.getByRole("button", { name: /^masuk$/i }));
    expect(await screen.findByText("Gagal memulai sesi kerja.")).toBeTruthy();
    expect(crewClaimShift).toHaveBeenCalledTimes(2);
    // Stayed on checkin (no navigation): the role grid + MASUK are still there.
    expect(screen.getByRole("button", { name: /^masuk$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /satgas/i })).toBeTruthy();
  });
});
