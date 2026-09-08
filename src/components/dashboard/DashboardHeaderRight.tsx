import { RoleEmblem } from "./RoleEmblem";
import { ThemeToggle } from "./ThemeToggle";
import { ProfileMenu } from "./ProfileMenu";
import { NotificationCenter } from "./NotificationCenter";
import type { StaleNotice } from "@/lib/manager-reminder";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function DashboardHeaderRight({
  roleLabel,
  profile,
  notifications,
  onChangePassword,
  onLogout,
}: {
  roleLabel: string;
  profile: { name: string; idManager?: string; canChangePassword?: boolean };
  notifications?: {
    stale: StaleNotice[];
    feed: OccupancyNotice[];
    unread: number;
    onOpen: () => void;
  };
  onChangePassword?: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      <RoleEmblem label={roleLabel} />
      <ThemeToggle />
      {notifications && (
        <NotificationCenter
          stale={notifications.stale}
          feed={notifications.feed}
          unread={notifications.unread}
          onOpen={notifications.onOpen}
        />
      )}
      <ProfileMenu
        name={profile.name}
        idManager={profile.idManager}
        canChangePassword={profile.canChangePassword}
        onChangePassword={onChangePassword}
        onLogout={onLogout}
      />
    </>
  );
}
