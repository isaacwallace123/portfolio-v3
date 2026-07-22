import Planned from "@/shared/ui/Planned";

export const metadata = { title: "Servers" };

export default function ServersPage() {
  return (
    <Planned
      kicker="Estate"
      title="Servers"
      intro="The homelab hub, rebuilt as part of the control plane — replacing the standalone dashboard at 192.168.0.220."
      bullets={[
        "Proxmox nodes: status, CPU/RAM/disk, running VMs",
        "k3s cluster health via the homelab Prometheus",
        "Service directory (the current homepage links), self-hosted",
        "Quick actions: restart, drain, wake-on-LAN",
        "Longhorn volumes & backup status",
        "cloudflared tunnel + DNS overview",
      ]}
    />
  );
}
