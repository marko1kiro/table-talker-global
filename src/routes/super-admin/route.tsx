import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
  Users2,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { isPublicSuperAdminPath } from "@/lib/super-admin-public-paths";
import { getAuthStatus, loginSuperAdmin, logout } from "@/lib/auth";
import {
  changeSuperAdminPassword,
  getBootstrapState,
  getSuperAdminProfile,
  updateOwnSuperAdminProfile,
} from "@/lib/super-admin-auth.server";
import { ChangePasswordDialog } from "@/components/dashboard/ChangePasswordDialog";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { isOwnerQueryKey } from "@/lib/owner-query-cache";
import { browserManagerStorage, removeManagerIdentity } from "@/lib/manager-session-identity";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";
import { Footer } from "@/components/Footer";

const nav = [
  { label: "Dashboard", to: "/super-admin", icon: CircleGauge, exact: true },
  { label: "Restoran", to: "/super-admin/restaurants", icon: Building2, exact: false },
  { label: "Manager", to: "/super-admin/managers", icon: Users, exact: false },
  { label: "Area Manager", to: "/super-admin/area-managers", icon: Users2, exact: false },
  { label: "Akun Super Admin", to: "/super-admin/staff-accounts", icon: UserCog, exact: false },
  { label: "Audit", to: "/super-admin/audit", icon: ScrollText, exact: false },
  { label: "Audio", to: "/super-admin/audio", icon: AudioLines, exact: false },
  { label: "Riwayat", to: "/super-admin/history", icon: History, exact: false },
  { label: "Error Log", to: "/super-admin/error-log", icon: TriangleAlert, exact: false },
  { label: "ESB & Export QR", to: "/super-admin/esb-export", icon: QrCode, exact: false },
] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Super Admin Console - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: SuperAdminShell,
});

function SuperAdminShell() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const mounted = useRef(true);
  const [logoutError, setLogoutError] = useState("");
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const profile = useQuery({
    queryKey: ["sa-profile"],
    queryFn: () => getSuperAdminProfile(),
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (isPublicSuperAdminPath(pathname)) {
    // Token-verified public pages: never show the login gate here.
    return <Outlet />;
  }

  if (!auth?.superAdmin) {
    return (
      <AuthGate
        onSuccess={() => {
          // Review A4: one role per browser — a Super Admin login wipes any
          // manager identity left in this tab's sessionStorage.
          removeManagerIdentity(browserManagerStorage());
          void router.invalidate();
        }}
        title="Login Super Admin"
        instruction="Password Super Admin."
        submitLabel="Masuk"
        staffLogin
        bootstrapStateLoader={getBootstrapState}
        loginAction={loginSuperAdmin}
      />
    );
  }

  async function handleLogout() {
    setLogoutError("");
    try {
      const result = await logout();
      if (!result.ok) {
        if (mounted.current) {
          setLogoutError("Logout gagal.");
        }
        return;
      }
      removeManagerIdentity(browserManagerStorage());
      queryClient.removeQueries({ predicate: (query) => isOwnerQueryKey(query.queryKey) });
      await router.invalidate();
    } catch {
      if (!mounted.current) return;
      setLogoutError("Logout gagal.");
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
            <ShieldCheck className="size-4 text-brand-500" /> Super Admin
          </span>
        </div>
      }
      navItems={navItems}
      headerTitle="Super Admin Console"
      headerRight={
        <DashboardHeaderRight
          roleLabel="SUPER ADMIN"
          profile={{
            name: profile.data?.individual ? profile.data.fullName : "Super Admin",
            idManager: profile.data?.individual ? profile.data.staffId : undefined,
            canChangePassword: profile.data?.individual === true,
          }}
          onChangePassword={() => setChangePasswordOpen(true)}
          onEditProfile={profile.data?.individual ? () => setEditProfileOpen(true) : undefined}
          onLogout={handleLogout}
        />
      }
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      {logoutError && (
        <p role="alert" className="mb-4 text-sm font-semibold text-ta-error">
          {logoutError}
        </p>
      )}
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        onSubmit={async (oldPassword, newPassword) => {
          const result = await changeSuperAdminPassword({ data: { oldPassword, newPassword } });
          if (result.ok) await handleLogout();
          return result;
        }}
      />
      {profile.data?.individual ? (
        <EditProfileDialog
          key={profile.data.fullName}
          open={editProfileOpen}
          currentName={profile.data.fullName}
          onOpenChange={setEditProfileOpen}
          onSubmit={async (fullName) => {
            const result = await updateOwnSuperAdminProfile({ data: { fullName } });
            if (result.ok) await queryClient.invalidateQueries({ queryKey: ["sa-profile"] });
            return result;
          }}
        />
      ) : null}
      <Outlet />
    </AppShell>
  );
}
