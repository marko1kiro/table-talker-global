import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

export type TableStatus = "empty" | "ready" | "playing" | "loading";

interface TableButtonProps {
  tableNumber: number;
  status: TableStatus;
  onClick: () => void;
  disabled?: boolean;
}

// Gradient border matches the LIME logo: blue -> cyan -> magenta.
const GRADIENT_FRAME =
  "rounded-xl bg-gradient-to-br from-blue-500 via-cyan-400 to-fuchsia-500 p-[2px]";

export function TableButton({ tableNumber, status, onClick, disabled = false }: TableButtonProps) {
  const isEmpty = status === "empty";
  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  // While another table is playing, every other table is disabled; their ready
  // numbers gray out so the single red "playing" number stands out.
  const dimmedReady = status === "ready" && disabled;

  return (
    <div className={cn("relative aspect-square w-full", GRADIENT_FRAME)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isEmpty || isLoading}
        aria-label={`Meja nomor ${tableNumber}`}
        className={cn(
          "relative flex size-full select-none flex-col items-center justify-center rounded-[10px] transition active:scale-[0.99] disabled:cursor-not-allowed",
          isPlaying
            ? "bg-red-50 dark:bg-red-500/10"
            : isEmpty
              ? "bg-ta-gray-100 dark:bg-ta-gray-700"
              : "bg-white dark:bg-ta-gray-800",
        )}
      >
        <span className="absolute left-1.5 top-1.5 text-[9px] font-bold leading-none">
          {isEmpty ? "KOSONG" : isPlaying ? "PLAY" : "SIAP"}
        </span>
        <span className="absolute right-1.5 top-1.5">
          {isEmpty ? (
            <VolumeX className="h-3 w-3 opacity-50" strokeWidth={3} />
          ) : (
            <Volume2 className={cn("h-3 w-3", isPlaying && "animate-pulse")} strokeWidth={3} />
          )}
        </span>
        <span
          className={cn(
            "text-[clamp(1.4rem,4vw,2.2rem)] leading-none font-black",
            isPlaying
              ? "text-red-600 dark:text-red-400"
              : status === "ready" && !dimmedReady && !isLoading
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-ta-gray-400 dark:text-ta-gray-500",
          )}
        >
          {tableNumber}
        </span>
        {isLoading && <span className="absolute bottom-1.5 text-[8px] font-bold">MEMUAT…</span>}
      </button>
    </div>
  );
}
