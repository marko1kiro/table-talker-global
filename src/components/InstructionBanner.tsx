import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Megaphone, Loader2 } from "lucide-react";
import { ackInstruction } from "@/lib/crew-instructions.server";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { REPLY_MAX_LENGTH } from "@/lib/instruction-domain";
import type { PendingInstruction } from "@/lib/instruction-domain";
import { formatWibClock } from "@/lib/manager-crew-groups";

export function InstructionBanner({
  instructions,
  roleSessionToken,
  accessToken,
  onDismiss,
}: {
  instructions: PendingInstruction[];
  roleSessionToken: string;
  accessToken: string;
  onDismiss: (instructionId: string) => void;
}) {
  const current = instructions[0];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16">
      <BannerCard
        instruction={current}
        roleSessionToken={roleSessionToken}
        accessToken={accessToken}
        remaining={instructions.length}
        onDismiss={onDismiss}
      />
    </div>
  );
}

function BannerCard({
  instruction,
  roleSessionToken,
  accessToken,
  remaining,
  onDismiss,
}: {
  instruction: PendingInstruction;
  roleSessionToken: string;
  accessToken: string;
  remaining: number;
  onDismiss: (id: string) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");

  const expired = new Date(instruction.expiresAt).getTime() < Date.now();

  const ack = useMutation({
    mutationFn: async (reply: string | null) => {
      const client = getSupabaseBrowserClient();
      const token = await getLiveAccessToken(client, accessToken);
      return ackInstruction({
        data: {
          roleSessionToken,
          accessToken: token,
          instructionId: instruction.instructionId,
          replyText: reply,
        },
      });
    },
    onSuccess: () => onDismiss(instruction.instructionId),
  });

  if (expired) {
    onDismiss(instruction.instructionId);
    return null;
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-ta-gray-200 bg-white p-5 shadow-xl dark:border-ta-gray-700 dark:bg-ta-gray-800">
      <div className="mb-3 flex items-center gap-2 text-brand-600 dark:text-brand-400">
        <Megaphone className="size-5 shrink-0" />
        <span className="text-xs font-bold uppercase">
          Instruksi dari {instruction.managerName}
        </span>
      </div>
      <p className="mb-1 text-sm font-semibold text-ta-gray-900 dark:text-white">
        {instruction.message}
      </p>
      <p className="mb-4 text-[11px] text-ta-gray-500 dark:text-ta-gray-400">
        {formatWibClock(instruction.createdAt)}
      </p>

      {remaining > 1 && (
        <p className="mb-3 text-[11px] font-bold text-ta-warning">
          +{remaining - 1} instruksi lainnya menunggu
        </p>
      )}

      {showReply && (
        <div className="mb-3">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            maxLength={100}
            placeholder="Tulis balasan singkat..."
            className="w-full rounded-lg border border-ta-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-ta-gray-600 dark:bg-ta-gray-700 dark:text-white"
          />
          <p className="mt-1 text-right text-[10px] text-ta-gray-400">
            {replyText.length}/{REPLY_MAX_LENGTH}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={ack.isPending}
          onClick={() => ack.mutate(showReply && replyText.trim() ? replyText.trim() : null)}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {ack.isPending ? <Loader2 className="mx-auto size-4 animate-spin" /> : "TERIMA"}
        </button>
        {!showReply && (
          <button
            type="button"
            onClick={() => setShowReply(true)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            Balas & Terima
          </button>
        )}
      </div>
    </div>
  );
}
