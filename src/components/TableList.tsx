import { useRef, ChangeEvent } from "react";
import { Upload, Trash2, Play } from "lucide-react";
import { TABLE_COUNT, uploadTableAudio, deleteTableAudio } from "@/lib/audio-store";

interface TableListProps {
  readyTables: Set<number>;
  onChanged: () => void;
  onPreview: (tableNumber: number) => void;
}

export function TableList({ readyTables, onChanged, onPreview }: TableListProps) {
  const tables = Array.from({ length: TABLE_COUNT }, (_, i) => i + 1);

  return (
    <div className="brutal-border brutal-shadow bg-card">
      <div className="flex items-center justify-between border-b-[3px] border-foreground px-4 py-2">
        <span className="font-display text-sm uppercase">Semua Meja</span>
        <span className="text-xs font-bold text-muted-foreground">
          {readyTables.size} / {TABLE_COUNT} siap
        </span>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto divide-y-[2px] divide-foreground/15">
        {tables.map((n) => (
          <TableRow
            key={n}
            tableNumber={n}
            ready={readyTables.has(n)}
            onChanged={onChanged}
            onPreview={() => onPreview(n)}
          />
        ))}
      </ul>
    </div>
  );
}

function TableRow({
  tableNumber,
  ready,
  onChanged,
  onPreview,
}: {
  tableNumber: number;
  ready: boolean;
  onChanged: () => void;
  onPreview: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { error } = await uploadTableAudio(tableNumber, file);
    e.target.value = "";
    if (error) {
      alert(`Gagal upload: ${error}`);
      return;
    }
    onChanged();
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus audio untuk meja ${tableNumber}?`)) return;
    const { error } = await deleteTableAudio(tableNumber);
    if (error) {
      alert(`Gagal hapus: ${error}`);
      return;
    }
    onChanged();
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2 sm:px-4">
      <div
        className={`brutal-border flex h-10 w-12 shrink-0 items-center justify-center font-display text-base ${
          ready ? "bg-accent" : "bg-muted opacity-60"
        }`}
      >
        {tableNumber}
      </div>
      <div className="flex-1 text-xs">
        <div className="font-bold uppercase">{ready ? "Siap" : "Kosong"}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{tableNumber}.mp3</div>
      </div>
      <div className="flex items-center gap-1.5">
        {ready && (
          <>
            <button
              onClick={onPreview}
              className="brutal-border brutal-shadow-sm brutal-press flex h-8 w-8 items-center justify-center bg-brutal-success/80"
              aria-label={`Preview meja ${tableNumber}`}
            >
              <Play className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
            <button
              onClick={handleDelete}
              className="brutal-border brutal-shadow-sm brutal-press flex h-8 w-8 items-center justify-center bg-destructive text-destructive-foreground"
              aria-label={`Hapus meja ${tableNumber}`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
          </>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          className="brutal-border brutal-shadow-sm brutal-press flex h-8 items-center gap-1 bg-card px-2 text-[10px] font-bold uppercase"
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={3} />
          {ready ? "Ganti" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          onChange={handleUpload}
          className="hidden"
        />
      </div>
    </li>
  );
}
