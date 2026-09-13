import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { TaCard, TaEmpty, TaNotice } from "@/components/dashboard/ui";
import { crewAccountList, crewAccountReset, crewSessionsEnd } from "@/lib/crew-auth.server";
import { refreshCarrierToken } from "@/lib/browser-auth";
import type { ManagerIdentity } from "@/lib/manager-session-identity";

const POLL_MS = 10_000;
// How long the "Yakin?" confirmation stays armed before falling back.
const CONFIRM_MS = 4_000;

function accountsKey(restaurantId: string) {
  return ["manager-crew-accounts", restaurantId] as const;
}

function visiblePoll() {
  return typeof document !== "undefined" && document.visibilityState === "visible"
    ? POLL_MS
    : false;
}

function badgeClass(active: boolean) {
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
    active ? "bg-ta-success/15 text-ta-success" : "bg-ta-gray-200 text-ta-gray-500"
  }`;
}

export function CrewAccountsCard({ identity }: { identity: ManagerIdentity }) {
  const queryClient = useQueryClient();
  const restaurantId = identity.restaurantId;
  // The account whose Reset is currently armed (awaiting the 2nd "Yakin?").
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearConfirm = () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmUid(null);
  };
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const accounts = useQuery({
    queryKey: accountsKey(restaurantId),
    queryFn: async () =>
      crewAccountList({
        data: {
          managerToken: identity.managerToken,
          accessToken: (await refreshCarrierToken()) ?? identity.accessToken,
        },
      }),
    enabled: Boolean(identity),
    refetchInterval: visiblePoll,
  });

  const endSessions = useMutation({
    mutationFn: async (authUid: string) =>
      crewSessionsEnd({
        data: {
          managerToken: identity.managerToken,
          accessToken: (await refreshCarrierToken()) ?? identity.accessToken,
          authUid,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) void queryClient.invalidateQueries({ queryKey: accountsKey(restaurantId) });
    },
  });

  const reset = useMutation({
    mutationFn: async (authUid: string) =>
      crewAccountReset({
        data: {
          managerToken: identity.managerToken,
          accessToken: (await refreshCarrierToken()) ?? identity.accessToken,
          authUid,
        },
      }),
    onSuccess: (result) => {
      clearConfirm();
      if (result.ok) void queryClient.invalidateQueries({ queryKey: accountsKey(restaurantId) });
    },
  });

  const rows = (accounts.data?.ok && accounts.data.accounts) || [];

  const onResetClick = (authUid: string) => {
    if (confirmUid === authUid) {
      reset.mutate(authUid); // 2nd tap -> fire
      return;
    }
    setConfirmUid(authUid); // 1st tap -> arm
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(clearConfirm, CONFIRM_MS);
  };

  return (
    <TaCard title="Akun Crew" className="mt-4">
      {accounts.isLoading && (
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">Memuat akun crew...</p>
      )}
      {accounts.data && !accounts.data.ok && (
        <TaNotice role="alert" tone="danger">
          {accounts.data.message}
        </TaNotice>
      )}
      {accounts.data?.ok && rows.length === 0 && (
        <TaEmpty
          title="Belum ada akun"
          description="Crew yang sudah pairing akan muncul di sini."
        />
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-ta-gray-200 dark:divide-ta-gray-700">
          {rows.map((r) => {
            const active = r.status === "aktif";
            const ending = endSessions.isPending && endSessions.variables === r.authUid;
            const resetting = reset.isPending && reset.variables === r.authUid;
            const armed = confirmUid === r.authUid;
            return (
              <li key={r.authUid} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-ta-gray-800 dark:text-ta-gray-100">
                      {r.fullName}
                    </p>
                    <span className={badgeClass(active)}>{r.status}</span>
                  </div>
                  <p className="truncate text-xs text-ta-gray-500 dark:text-ta-gray-400">
                    {r.email}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] font-bold uppercase">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        r.hasActiveDevice
                          ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                          : "bg-ta-gray-100 text-ta-gray-400"
                      }`}
                    >
                      <ShieldCheck className="size-3" />
                      {r.hasActiveDevice ? "perangkat aktif" : "belum claim"}
                    </span>
                    <span className="text-ta-gray-400">{r.activeSessions} sesi</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={r.activeSessions === 0 || ending}
                    onClick={() => endSessions.mutate(r.authUid)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-ta-warning/40 bg-ta-warning/10 px-3 text-xs font-bold uppercase text-ta-warning transition hover:bg-ta-warning/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {ending && <Loader2 className="size-3.5 animate-spin" />}
                    Cabut sesi
                  </button>
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={() => onResetClick(r.authUid)}
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold uppercase transition disabled:opacity-50 ${
                      armed
                        ? "border-ta-error bg-ta-error text-white"
                        : "border-ta-error/40 bg-ta-error/10 text-ta-error hover:bg-ta-error/20"
                    }`}
                  >
                    {resetting && <Loader2 className="size-3.5 animate-spin" />}
                    {armed ? "Yakin?" : "Reset akun"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </TaCard>
  );
}
