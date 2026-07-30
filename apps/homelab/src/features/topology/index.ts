// Public surface of the topology slice. Everything else under here — the grouped map layout, the
// inventory poll, the viewport, and the pieces that draw a container or a component — is internal,
// so the route only ever depends on the one thing it actually renders.
export { TopologyBoard } from "./ui/TopologyBoard";
export { useTopology } from "./model/useTopology";
export { LAYERS, layerIcon, layerLabel, type LayerId } from "./model/layers";
export {
  layoutGrouped,
  curvePath,
  type GroupedLayout,
  type GroupBox,
  type MemberBox,
  type MapEdge,
} from "./model/grouped";
