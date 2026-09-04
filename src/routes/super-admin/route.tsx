import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  AudioLines,
  Building2,
  CircleGauge,
  History,
  QrCode,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin, logout } from "@/lib/auth";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import { taSecondaryButtonClass } from "@/components/dashboard/ui";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

const nav = [
  { label: "Dashboard", to: "/super-admin", icon: CircleGauge, exact: true },
  { label: "Restoran", to: "/super-admin/restaurants", icon: Building2, exact: false },
  { label: "Manager", to: "/super-admin/managers", icon: Users, exact: false },
  { label: "Audio", to: "/super-admin/audio", icon: AudioLines, exact: false },
  { label: "Riwayat", to: "/super-admin/history", icon: History, exact: false },
  { label: "Error Log", to: "/super-admin/error-log", icon: TriangleAlert, exact: false },
  { label: "ESB & Export QR", to: "/super-admin/esb-export", icon: QrCode, exact: false },
] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Owner Console - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: OwnerShell,
});

function OwnerShell() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const mounted = useRef(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!auth?.superAdmin) {
    return (
      <AuthGate
        onSuccess={() => router.invalidate()}
        title="Login Owner"
        instruction="Masukkan password owner."
        submitLabel="Masuk"
        loginAction={loginSuperAdmin}
      />
    );
  }

  async function handleLogout() {
    setLogoutError("");
    setLoggingOut(true);
    try {
      const result = await logout();
      if (!result.ok) {
        if (mounted.current) {
          setLogoutError("Logout gagal.");
          setLoggingOut(false);
        }
        return;
      }
      queryClient.removeQueries({ predicate: (query) => isOwnerQueryKey(query.queryKey) });
      if (mounted.current) setLoggingOut(false);
      await router.invalidate();
    } catch {
      if (!mounted.current) return;
      setLogoutError("Logout gagal.");
      setLoggingOut(false);
    }
  }

  const navItems: AppShellNavItem[] = nav.map((item) => ({
    id: item.to,
    label: item.label,
    icon: item.icon,
    active: item.exact ? pathname === item.to : pathname.startsWith(item.to),
    onSelect: () => void navigate({ to: item.to }),
  }));

  return (
    <AppShell
      brand={
        <div className="flex items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0" />
          <span className="flex items-center gap-1 text-sm font-bold text-ta-gray-900">
            <ShieldCheck className="size-4 text-brand-500" /> Owner
          </span>
        </div>
      }
      navItems={navItems}
      headerTitle="Owner Console"
      headerRight={
        <>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className={taSecondaryButtonClass}
          >
            {loggingOut ? "Keluar..." : "Keluar"}
          </button>
        </>
      }
    >
      {logoutError && (
        <p role="alert" className="mb-4 text-sm font-semibold text-ta-error">
          {logoutError}
        </p>
      )}
      <Outlet />
    </AppShell>
  );
}
