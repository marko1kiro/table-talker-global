// @vitest-environment jsdom
// Poin 3 Task 10: manager dashboard crew cards. Rendered in isolation (identity
// passed as a prop; only @/lib/crew-auth.server + @/lib/browser-auth mocked) so
// the tests assert the cards' own wiring, not the whole dashboard shell:
//  - CrewPairingCard: big OTP, per-row countdown, Tolak -> exact reject payload
//    + list invalidate (row disappears), expired row drops on countdown hit 0,
//    ok:false -> TaNotice, empty -> TaEmpty.
//  - CrewAccountsCard: status/device badges, activeSessions count, Cabut sesi
//    disabled at 0, Reset requires a 2nd "Yakin?" click then fires the exact
//    payload + invalidate, ok:false -> TaNotice.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { ManagerIdentity } from "@/lib/manager-session-identity";
import type {
  CrewAccountRow,
  CrewAccountListResult,
  CrewPairingListResult,
  CrewVerdictResult,
} from "@/lib/crew-auth.server";
import { CrewPairingCard } from "@/components/manager/CrewPairingCard";
import { CrewAccountsCard } from "@/components/manager/CrewAccountsCard";

const crewPairingList = vi.fn<[], Promise<CrewPairingListResult>>();
const crewPairingReject = vi.fn<[], Promise<CrewVerdictResult>>();
const crewAccountList = vi.fn<[], Promise<CrewAccountListResult>>();
const crewAccountReset = vi.fn<[], Promise<CrewVerdictResult>>();
const crewSessionsEnd = vi.fn<[], Promise<CrewVerdictResult>>();
const refreshCarrierToken = vi.fn<[], Promise<string>>();

vi.mock("@/lib/crew-auth.server", () => ({
  crewPairingList: (a: unknown) => crewPairingList(a),
  crewPairingReject: (a: unknown) => crewPairingReject(a),
  crewAccountList: (a: unknown) => crewAccountList(a),
  crewAccountReset: (a: unknown) => crewAccountReset(a),
  crewSessionsEnd: (a: unknown) => crewSessionsEnd(a),
}));
vi.mock("@/lib/browser-auth", () => ({
  refreshCarrierToken: () => refreshCarrierToken(),
}));

const IDENTITY: ManagerIdentity = {
  idManager: "kasir.satgas01",
  fullName: "Man Ager",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "minted-tok",
  accessToken: "anon-tok",
};

function renderCard(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function pendingPairing(id: string, email: string, name: string, otp: string, ttlMs: number) {
  const now = Date.now();
  return {
    id,
    email,
    fullName: name,
    otp,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

const account = (over: Partial<CrewAccountRow> & { authUid: string }): CrewAccountRow => ({
  email: "crew@example.com",
  fullName: "Crew One",
  status: "aktif",
  pairedAt: new Date().toISOString(),
  hasActiveDevice: false,
  activeSessions: 0,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  refreshCarrierToken.mockResolvedValue("carrier-tok");
  crewPairingReject.mockResolvedValue({ ok: true });
  crewAccountReset.mockResolvedValue({ ok: true });
  crewSessionsEnd.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CrewPairingCard", () => {
  it("renders email, name, big mono OTP and a countdown + Tolak button", async () => {
    crewPairingList.mockResolvedValue({
      ok: true,
      requests: [pendingPairing("p-1", "a@x.com", "Andi", "483920", 60_000)],
    });
    renderCard(<CrewPairingCard identity={IDENTITY} />);
    expect(await screen.findByText("a@x.com")).toBeTruthy();
    expect(screen.getByText("Andi")).toBeTruthy();
    const otp = screen.getByText("483920");
    expect(otp.className).toMatch(/text-3xl/);
    expect(otp.className).toMatch(/font-mono/);
    expect(otp.className).toMatch(/tracking-widest/);
    // countdown mm:ss present
    expect(screen.getByText(/\d+:\d\d/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /tolak/i })).toBeTruthy();
    expect(crewPairingList).toHaveBeenCalledWith({
      data: { managerToken: "minted-tok", accessToken: "carrier-tok" },
    });
  });

  it("reject fires the exact payload and invalidates the list (row disappears)", async () => {
    crewPairingList
      .mockResolvedValueOnce({
        ok: true,
        requests: [pendingPairing("p-1", "drop@x.com", "Droppo", "111111", 60_000)],
      })
      .mockResolvedValue({ ok: true, requests: [] });
    renderCard(<CrewPairingCard identity={IDENTITY} />);
    await screen.findByText("drop@x.com");
    fireEvent.click(screen.getByRole("button", { name: /tolak/i }));
    await waitFor(() =>
      expect(crewPairingReject).toHaveBeenCalledWith({
        data: { managerToken: "minted-tok", accessToken: "carrier-tok", requestId: "p-1" },
      }),
    );
    // list invalidated -> refetched -> row gone -> empty state
    await waitFor(() => expect(crewPairingList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Tidak ada permintaan")).toBeTruthy();
  });

  it("an expired row disappears locally when its countdown hits zero (fake timers)", async () => {
    crewPairingList.mockResolvedValue({
      ok: true,
      requests: [pendingPairing("p-x", "exp@x.com", "Expi", "654321", 2_000)],
    });
    vi.useFakeTimers();
    const flush = async (ms = 1_000) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    renderCard(<CrewPairingCard identity={IDENTITY} />);
    await flush(0); // let the mounted query resolve
    expect(screen.getByText("exp@x.com")).toBeTruthy();
    await flush(3_000); // past the 2s expiry -> tick recomputes, row dropped
    expect(screen.queryByText("exp@x.com")).toBeNull();
    expect(screen.getByText("Tidak ada permintaan")).toBeTruthy();
  });

  it("ok:false renders a danger TaNotice", async () => {
    crewPairingList.mockResolvedValue({ ok: false, code: "UNAVAILABLE", message: "boom" });
    renderCard(<CrewPairingCard identity={IDENTITY} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
  });
});

describe("CrewAccountsCard", () => {
  it("renders status badge, device chip and active session count per row", async () => {
    crewAccountList.mockResolvedValue({
      ok: true,
      accounts: [
        account({
          authUid: "u-active",
          fullName: "Aktif Ana",
          status: "aktif",
          hasActiveDevice: true,
          activeSessions: 2,
        }),
        account({
          authUid: "u-off",
          fullName: "Nonaktif Noni",
          status: "nonaktif",
          hasActiveDevice: false,
          activeSessions: 0,
        }),
      ],
    });
    renderCard(<CrewAccountsCard identity={IDENTITY} />);
    expect(await screen.findByText("Aktif Ana")).toBeTruthy();
    expect(screen.getByText("Nonaktif Noni")).toBeTruthy();
    expect(screen.getByText("aktif")).toBeTruthy();
    expect(screen.getByText("nonaktif")).toBeTruthy();
    expect(screen.getByText("perangkat aktif")).toBeTruthy();
    expect(screen.getByText("belum claim")).toBeTruthy();
    expect(screen.getByText("2 sesi")).toBeTruthy();
    expect(screen.getByText("0 sesi")).toBeTruthy();
    expect(crewAccountList).toHaveBeenCalledWith({
      data: { managerToken: "minted-tok", accessToken: "carrier-tok" },
    });
  });

  it("Cabut sesi is disabled at 0 sessions, enabled + correct payload above 0", async () => {
    crewAccountList.mockResolvedValue({
      ok: true,
      accounts: [
        account({ authUid: "u-0", fullName: "Zero", activeSessions: 0 }),
        account({ authUid: "u-3", fullName: "Three", activeSessions: 3 }),
      ],
    });
    renderCard(<CrewAccountsCard identity={IDENTITY} />);
    await screen.findByText("Zero");
    const cabut = screen.getAllByRole("button", { name: /cabut sesi/i });
    expect((cabut[0] as HTMLButtonElement).disabled).toBe(true); // Zero
    expect((cabut[1] as HTMLButtonElement).disabled).toBe(false); // Three
    fireEvent.click(cabut[1]);
    await waitFor(() =>
      expect(crewSessionsEnd).toHaveBeenCalledWith({
        data: { managerToken: "minted-tok", accessToken: "carrier-tok", authUid: "u-3" },
      }),
    );
  });

  it("Reset needs a second 'Yakin?' click, then fires the exact payload + invalidates", async () => {
    crewAccountList
      .mockResolvedValueOnce({
        ok: true,
        accounts: [account({ authUid: "u-r", fullName: "Resetta" })],
      })
      .mockResolvedValue({ ok: true, accounts: [] });
    renderCard(<CrewAccountsCard identity={IDENTITY} />);
    await screen.findByText("Resetta");
    const resetBtn = screen.getByRole("button", { name: /reset akun/i });
    fireEvent.click(resetBtn); // first tap: arm, no call yet
    expect(crewAccountReset).not.toHaveBeenCalled();
    // label flips to the confirmation prompt
    const armed = screen.getByRole("button", { name: /yakin\?/i });
    fireEvent.click(armed); // second tap: fire
    await waitFor(() =>
      expect(crewAccountReset).toHaveBeenCalledWith({
        data: { managerToken: "minted-tok", accessToken: "carrier-tok", authUid: "u-r" },
      }),
    );
    await waitFor(() => expect(crewAccountList).toHaveBeenCalledTimes(2));
  });

  it("the 'Yakin?' arm clears after its timeout without a second click", async () => {
    vi.useFakeTimers();
    const flush = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    crewAccountList.mockResolvedValue({
      ok: true,
      accounts: [account({ authUid: "u-arm", fullName: "Armo" })],
    });
    renderCard(<CrewAccountsCard identity={IDENTITY} />);
    await flush(0);
    fireEvent.click(screen.getByRole("button", { name: /reset akun/i }));
    expect(screen.getByRole("button", { name: /yakin\?/i })).toBeTruthy();
    await flush(4_100); // past the 4s arm timeout
    expect(screen.getByRole("button", { name: /reset akun/i })).toBeTruthy();
    expect(crewAccountReset).not.toHaveBeenCalled();
  });

  it("ok:false renders a danger TaNotice", async () => {
    crewAccountList.mockResolvedValue({ ok: false, code: "UNAVAILABLE", message: "kaboom" });
    renderCard(<CrewAccountsCard identity={IDENTITY} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("kaboom");
  });
});
