import { X } from "lucide-react";

export function CrewMessageOverlay({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      className="brutal-border brutal-shadow-xl fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded border-2 border-foreground bg-card p-6 text-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Tutup"
          className="brutal-border brutal-press bg-accent px-2 py-1 absolute top-3 right-3"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
        <p className="font-display text-lg uppercase leading-snug">{message}</p>
        <button
          type="button"
          className="brutal-border brutal-press mt-5 w-full bg-accent px-3 py-2 font-display uppercase"
          onClick={onClose}
        >
          OK Bang!
        </button>
      </div>
    </div>
  );
}
