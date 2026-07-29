import {
  AppWindow,
  Boxes,
  Database,
  LineChart,
  Network,
  Server,
  type LucideIcon,
} from "lucide-react";

/** The six sanitized layers, in the order the legend and the filter list them. */
export const LAYERS = [
  { id: "compute", label: "Compute", icon: Server },
  { id: "network", label: "Network", icon: Network },
  { id: "platform", label: "Platform", icon: Boxes },
  { id: "data", label: "Data", icon: Database },
  { id: "observe", label: "Observe", icon: LineChart },
  { id: "apps", label: "Applications", icon: AppWindow },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type LayerId = (typeof LAYERS)[number]["id"];

const ICONS = new Map<string, LucideIcon>(LAYERS.map((l) => [l.id, l.icon]));

export const layerIcon = (layer: string): LucideIcon =>
  ICONS.get(layer) ?? Boxes;

export const layerLabel = (layer: string): string =>
  LAYERS.find((l) => l.id === layer)?.label ?? layer;
