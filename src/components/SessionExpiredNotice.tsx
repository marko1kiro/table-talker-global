import { LogOut, ShieldAlert } from "lucide-react";
import { ownerPrimaryButtonClass } from "./OwnerUi";

export function SessionExpiredNotice({ onLogout }: { onLogout: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border-2 border-red-200 bg-red-50/80 p-6 text-center dark:border-red-500/30 dark:bg-red-500/10"
    >
      <div className="mb-3 grid size-12 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
        <ShieldAlert className="size-6" />
      </div>
      <h3 className="text-lg font-extrabold text-red-950 dark:text-red-200">
        Sesi Anda Telah Berakhir
      </h3>
      <p className="mt-1.5 max-w-md text-sm text-red-700 dark:text-red-300">
        Data testing baru saja di-reset oleh Super Admin atau sesi Anda telah kedaluwarsa. Silakan
        login kembali untuk melanjutkan.
      </p>
      <div className="mt-5">
        <button
          type="button"
          onClick={onLogout}
          className={`${ownerPrimaryButtonClass} bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700`}
        >
          <LogOut className="size-4" />
          Login Ulang
        </button>
      </div>
    </div>
  );
}
