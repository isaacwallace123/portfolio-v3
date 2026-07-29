// Public surface of the topology slice. Everything else under here — the layered-DAG layout engine,
// the inventory poll, the viewport, and the pieces that draw a node or a connector — is internal, so
// the route only ever depends on the one thing it actually renders.
export { TopologyBoard } from "./ui/TopologyBoard";
export { useTopology } from "./model/useTopology";
export { LAYERS, layerIcon, layerLabel, type LayerId } from "./model/layers";
export {
  layoutFlow,
  orthogonalPath,
  type FlowLayout,
  type FlowNodeBox,
  type FlowEdgeRoute,
} from "./model/layout";
