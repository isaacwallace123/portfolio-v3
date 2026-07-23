"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getMe, type PortfolioSiteId, type SessionUser } from "@iw/core";
import { AccountMenu } from "./AccountMenu";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { SettingsModal } from "./SettingsModal";

export function NetworkControls({
  current,
  siteTab,
}: {
  current: PortfolioSiteId;
  siteTab?: ReactNode;
}) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [here] = useState(() =>
    typeof window === "undefined" ? "" : window.location.href,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getMe().then((value) => alive && setUser(value));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <NetworkSwitcher current={current} />
      <AccountMenu
        user={user}
        here={here}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && (
        <SettingsModal
          user={user ?? null}
          onUser={setUser}
          onClose={() => setSettingsOpen(false)}
          initialTab="profile"
          siteTab={siteTab}
        />
      )}
    </div>
  );
}
