import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { TaCard, TaEmpty, TaNotice } from "@/components/dashboard/ui";
import { crewPairingList, crewPairingReject } from "@/lib/crew-auth.server";
import { refreshCarrierToken } from "@/lib/browser-auth";
import type { ManagerIdentity } from "@/lib/manager-session-identity";

const POLL_MS = 10_000;

function pairingKey(restaurantId: string) {
  return ["manager-crew-pairing", restaurantId] as const;
}

// Only poll while the tab is actually visible: a backgrounded manager dashboard
// must not keep hammering the pairing RPC every 10s.
function visiblePoll() {
  return typeof document !== "undefined" && document.visibilityState === "visible"
    ? POLL_MS
    : false;
}

// mm:ss remaining, floored at 00:00 (the row itself is dropped once expired).
function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function CrewPairingCard({ identity }: { identity: ManagerIdentity }) {
  const queryClient = useQueryClient();
  const restaurantId = identity.restaurantId;
  const [now, setNow] = useState(() => Date.now());

  // 1s tick: recomputes each row's countdown and re-runs the expiry filter so a
  // burned request vanishes locally the moment it hits 0, without waiting on the
  // server list's next 10s poll.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const requests = useQuery({
    queryKey: pairingKey(restaurantId),
    queryFn: async () =>
      crewPairingList({
        data: {
          managerToken: identity.managerToken,
          accessToken: (await refreshCarrierToken()) ?? identity.accessToken,
        },
      }),
    enabled: Boolean(identity),
    refetchInterval: visiblePoll,
  });

  const reject = useMutation({
    mutationFn: async (requestId: string) =>
      crewPairingReject({
        data: {
          managerToken: identity.managerToken,
          accessToken: (await refreshCarrierToken()) ?? identity.accessToken,
          requestId,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: pairingKey(restaurantId) });
      }
    },
  });

  const pending = (requests.data?.ok && requests.data.requests) || [];
  const live = pending.filter((r) => new Date(r.expiresAt).getTime() > now);

  return (
    <TaCard title="Permintaan Crew" className="mt-4">
      {requests.isLoading && (
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">Memuat permintaan crew...</p>
      )}
      {requests.data && !requests.data.ok && (
        <TaNotice role="alert" tone="danger">
          {requests.data.message}
        </TaNotice>
      )}
      {requests.data?.ok && live.length === 0 && (
        <TaEmpty title="Tidak ada permintaan" description="Belum ada crew menunggu persetujuan." />
      )}
      {live.length > 0 && (
        <ul className="divide-y divide-ta-gray-200 dark:divide-ta-gray-700">
          {live.map((r) => {
            const busy = reject.isPending && reject.variables === r.id;
            return (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ta-gray-800 dark:text-ta-gray-100">
                    {r.fullName}
                  </p>
                  <p className="truncate text-xs text-ta-gray-500 dark:text-ta-gray-400">
                    {r.email}
                  </p>
                </div>
                <div className="shrink-0 text-center">
                  <p className="text-3xl font-mono font-black tracking-widest text-brand-600 dark:text-brand-300">
                    {r.otp}
                  </p>
                  <p className="text-[10px] font-bold tabular-nums text-ta-gray-400">
                    {formatCountdown(new Date(r.expiresAt).getTime() - now)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => reject.mutate(r.id)}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ta-error/30 bg-ta-error/10 px-3 text-xs font-bold uppercase text-ta-error transition hover:bg-ta-error/20 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                  Tolak
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </TaCard>
  );
}
