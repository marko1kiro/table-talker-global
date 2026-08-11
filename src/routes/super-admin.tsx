import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin } from "@/lib/auth";
import { getRemoteAdminSnapshot, sendRemoteCommand } from "@/lib/remote-audio.server";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  canPlayRemoteAudio,
  commandStatus,
  reconcileRemoteSelection,
} from "@/lib/super-admin-state";

const snapshotKey = ["remote-admin-snapshot"] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Super Admin — Table Talker" }, { name: "robots", content: "noindex" }],
  }),
  component: SuperAdminRoute,
});

function SuperAdminRoute() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  if (!auth.superAdmin) {
    return (
      <AuthGate
        onSuccess={() => router.invalidate()}
        title="Login Super Admin"
        instruction="Masukkan password khusus untuk remote audio."
        submitLabel="Masuk"
        loginAction={loginSuperAdmin}
      />
    );
  }
  return <SuperAdminPage />;
}

function SuperAdminPage() {
  const queryClient = useQueryClient();
  const [targetSessionId, setTargetSessionId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [sendError, setSendError] = useState("");
  const [now, setNow] = useState(Date.now());
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: () => getRemoteAdminSnapshot(),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: () => sendRemoteCommand({ data: { targetSessionId, audioId } }),
    onSuccess: () => {
      setSendError("");
      queryClient.invalidateQueries({ queryKey: snapshotKey });
    },
    onError: () => setSendError("Gagal mengirim perintah. Silakan coba lagi."),
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const channel = client
      .channel("super-admin-remote-audio")
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_sessions" }, () => {
        queryClient.invalidateQueries({ queryKey: snapshotKey });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "remote_commands" }, () => {
        queryClient.invalidateQueries({ queryKey: snapshotKey });
      })
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [queryClient]);

  const data = snapshot.data;
  const offline = !data || data.offline;
  const sessions = useMemo(() => (data && !data.offline ? data.sessions : []), [data]);
  const catalog = useMemo(() => (data && !data.offline ? data.catalog : []), [data]);
  const commands = data && !data.offline ? data.commands : [];

  useEffect(() => {
    const selection = reconcileRemoteSelection(
      targetSessionId,
      audioId,
      sessions.map((session) => ({
        id: session.id,
        eligible: session.eligible,
        audioReady: session.audio_ready,
      })),
      catalog.map((audio) => audio.id),
    );
    if (selection.targetSessionId !== targetSessionId)
      setTargetSessionId(selection.targetSessionId);
    if (selection.audioId !== audioId) setAudioId(selection.audioId);
  }, [audioId, catalog, sessions, targetSessionId]);

  const canPlay = canPlayRemoteAudio({
    offline,
    targetSessionId,
    audioId,
    pending: mutation.isPending,
  });
  const selectedTarget = sessions.find((session) => session.id === targetSessionId);

  return (
    <main className="min-h-[100svh] bg-background px-4 py-6 sm:px-6">
      <section className="brutal-border brutal-shadow-lg mx-auto max-w-4xl bg-card p-4 sm:p-6">
        <h1 className="font-display text-xl uppercase sm:text-2xl">Super Admin Remote Audio</h1>
        {offline ? (
          <p
            role="status"
            className="brutal-border mt-4 bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground"
          >
            Realtime offline
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Pilih crew siap audio lalu kirim suara bundled.
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold">
            Target crew
            <select
              value={targetSessionId}
              onChange={(event) => setTargetSessionId(event.target.value)}
              className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
              disabled={offline}
            >
              <option value="">Pilih crew</option>
              {sessions
                .filter((session) => session.eligible && session.audio_ready)
                .map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.display_name} — {session.device_description}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            Audio
            <select
              value={audioId}
              onChange={(event) => setAudioId(event.target.value)}
              className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
              disabled={offline}
            >
              <option value="">Pilih audio</option>
              {catalog.map((audio) => (
                <option key={audio.id} value={audio.id}>
                  {audio.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedTarget && (
          <p className="mt-2 text-xs text-muted-foreground">
            {selectedTarget.eligible && selectedTarget.audio_ready
              ? "Online dan siap audio."
              : "Target tidak siap audio."}
          </p>
        )}
        {(sendError || (mutation.data && "error" in mutation.data && mutation.data.error)) && (
          <p role="alert" className="mt-3 text-sm font-bold text-destructive">
            {sendError || (mutation.data && "error" in mutation.data ? mutation.data.error : "")}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setSendError("");
            mutation.reset();
            mutation.mutate();
          }}
          disabled={!canPlay}
          className="brutal-border brutal-shadow brutal-press mt-5 w-full bg-accent px-4 py-3 font-display uppercase disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? "Mengirim…" : "Play audio"}
        </button>
      </section>
      <section
        className="brutal-border mx-auto mt-6 max-w-4xl bg-card p-4 sm:p-6"
        aria-labelledby="audit-heading"
      >
        <h2 id="audit-heading" className="font-display text-lg uppercase">
          Audit 7 Hari
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Status</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Target</th>
                <th className="p-2">Audio</th>
                <th className="p-2">Waktu</th>
                <th className="p-2">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((command) => {
                const target = sessions.find((session) => session.id === command.target_session_id);
                const audio = catalog.find((item) => item.id === command.audio_id);
                return (
                  <tr key={command.id} className="border-b align-top">
                    <td className="p-2 font-bold">{commandStatus(command, now)}</td>
                    <td className="p-2">{command.actor}</td>
                    <td className="p-2">{target?.display_name ?? command.target_session_id}</td>
                    <td className="p-2">{audio?.label ?? command.audio_id}</td>
                    <td className="p-2">{new Date(command.created_at).toLocaleString("id-ID")}</td>
                    <td className="p-2">{command.failure_reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!offline && commands.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Belum ada perintah dalam 7 hari terakhir.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
