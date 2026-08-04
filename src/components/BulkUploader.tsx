import { useState, useCallback, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { UploadCloud, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { tableNumberFromFileName, uploadTableAudio, TABLE_COUNT } from "@/lib/audio-store";

interface BulkUploaderProps {
  onUploaded: () => void;
}

interface UploadItem {
  fileName: string;
  tableNumber: number | null;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
}

export function BulkUploader({ onUploaded }: BulkUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const initial: UploadItem[] = files.map((f) => {
      const n = tableNumberFromFileName(f.name);
      return {
        fileName: f.name,
        tableNumber: n,
        status: n === null ? "error" : "pending",
        message: n === null ? `Nama file tidak valid (harus 1.mp3–${TABLE_COUNT}.mp3)` : undefined,
      };
    });
    setItems(initial);
    setIsProcessing(true);

    for (let i = 0; i < files.length; i++) {
      const item = initial[i];
      if (item.tableNumber === null) continue;
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "uploading" } : it)));
      const { error } = await uploadTableAudio(item.tableNumber, files[i]);
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i
            ? {
                ...it,
                status: error ? "error" : "done",
                message: error ?? "Berhasil di-upload",
              }
            : it,
        ),
      );
    }

    setIsProcessing(false);
    onUploadedRef.current();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        void processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        void processFiles(e.target.files);
        e.target.value = "";
      }
    },
    [processFiles],
  );

  return (
    <section className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`brutal-border brutal-press cursor-pointer bg-card p-6 text-center transition-colors sm:p-10 ${
          isDragging ? "brutal-shadow-lg bg-accent" : "brutal-shadow"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          multiple
          onChange={handleChange}
          className="hidden"
        />
        <UploadCloud className="mx-auto h-10 w-10" strokeWidth={2.5} />
        <div className="mt-3 font-display uppercase">Upload File Panggilan</div>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Drag & drop atau klik untuk pilih. Nama file harus nomor meja saja:{" "}
          <span className="font-mono font-bold text-foreground">1.mp3</span>,{" "}
          <span className="font-mono font-bold text-foreground">25.mp3</span>, dst.
        </p>
      </div>

      {items.length > 0 && (
        <div className="brutal-border brutal-shadow bg-card">
          <div className="flex items-center justify-between border-b-[3px] border-foreground px-4 py-2">
            <span className="font-display text-sm uppercase">Progress</span>
            <span className="text-xs font-bold text-muted-foreground">
              {items.filter((i) => i.status === "done").length} / {items.length} selesai
            </span>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y-[2px] divide-foreground/20">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                <StatusIcon status={it.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-bold">{it.fileName}</div>
                  {it.message && (
                    <div
                      className={`truncate text-[10px] ${
                        it.status === "error" ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {it.message}
                    </div>
                  )}
                </div>
                {it.tableNumber !== null && (
                  <span className="brutal-border bg-brutal-bg px-2 py-0.5 font-display text-xs">
                    #{it.tableNumber}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isProcessing && (
        <p className="text-center text-xs font-bold uppercase text-muted-foreground">
          Sedang meng-upload…
        </p>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 text-brutal-success" strokeWidth={3} />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" strokeWidth={3} />;
  if (status === "uploading") return <Loader2 className="h-4 w-4 animate-spin" strokeWidth={3} />;
  return <div className="h-4 w-4 rounded-full border-2 border-foreground/40" />;
}
