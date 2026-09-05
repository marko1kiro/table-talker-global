import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

export type TableStatus = "empty" | "ready" | "playing" | "loading";

interface TableButtonProps {
  tableNumber: number;
  status: TableStatus;
  onClick: () => void;
  disabled?: boolean;
}

export function TableButton({ tableNumber, status, onClick, disabled = false }: TableButtonProps) {
  const isEmpty = status === "empty";
  const isPlaying = status === "playing";
  const isLoading = status === "loading";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isEmpty || isLoading}
      aria-label={`Meja nomor ${tableNumber}`}
      className={cn(
        "relative flex aspect-square w-full select-none flex-col items-center justify-center rounded-xl border shadow-theme-sm transition active:scale-[0.99] disabled:cursor-not-allowed",
        isPlaying
          ? "border-brand-500 bg-brand-500 text-white shadow-theme-md"
          : isEmpty
            ? "border-ta-gray-200 bg-ta-gray-100 text-ta-gray-400 dark:border-ta-gray-700 dark:bg-ta-gray-700 dark:text-ta-gray-500"
            : "border-ta-gray-200 bg-white text-ta-gray-900 hover:border-brand-300 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-white",
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
      <span className="text-[clamp(1.4rem,4vw,2.2rem)] leading-none font-black">{tableNumber}</span>
      {isLoading && <span className="absolute bottom-1.5 text-[8px] font-bold">MEMUAT…</span>}
    </button>
  );
}
