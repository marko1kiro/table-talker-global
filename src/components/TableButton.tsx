import { Volume2, VolumeX } from "lucide-react";

export type TableStatus = "empty" | "ready" | "playing" | "loading";

interface TableButtonProps {
  tableNumber: number;
  status: TableStatus;
  onClick: () => void;
}

export function TableButton({ tableNumber, status, onClick }: TableButtonProps) {
  const isEmpty = status === "empty";
  const isPlaying = status === "playing";
  const isLoading = status === "loading";

  const base =
    "brutal-border brutal-press relative flex aspect-square w-full flex-col items-center justify-center font-display uppercase select-none";
  const state = isPlaying
    ? "bg-accent brutal-shadow-lg"
    : isEmpty
      ? "bg-muted brutal-shadow-sm opacity-60"
      : "bg-card brutal-shadow";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isEmpty || isLoading}
      aria-label={`Meja nomor ${tableNumber}`}
      className={`${base} ${state}`}
    >
      <span className="absolute left-1 top-1 text-[9px] font-bold leading-none">
        {isEmpty ? "KOSONG" : isPlaying ? "PLAY" : "SIAP"}
      </span>
      <span className="absolute right-1 top-1">
        {isEmpty ? (
          <VolumeX className="h-3 w-3 opacity-50" strokeWidth={3} />
        ) : (
          <Volume2 className={`h-3 w-3 ${isPlaying ? "animate-pulse" : ""}`} strokeWidth={3} />
        )}
      </span>
      <span className="text-[clamp(1.4rem,4vw,2.2rem)] leading-none">{tableNumber}</span>
      {isLoading && <span className="absolute bottom-1 text-[8px] font-bold">MEMUAT…</span>}
    </button>
  );
}
