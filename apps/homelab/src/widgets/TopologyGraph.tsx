"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  Cpu,
  GitPullRequest,
  Layers3,
  MemoryStick,
  MousePointer2,
  RefreshCw,
} from "lucide-react";
import * as THREE from "three";
import {
  fetchTopology,
  type HomelabTopology,
  type TopologyNode,
} from "@/shared/lib/liveClient";

const LAYERS = [
  ["compute", "Compute"],
  ["network", "Network"],
  ["platform", "Platform"],
  ["data", "Data"],
  ["observe", "Observe"],
  ["apps", "Applications"],
] as const;

const LAYER_X: Record<string, number> = {
  compute: -10,
  network: -6,
  platform: -2,
  data: 2,
  observe: 5.5,
  apps: 9.5,
};

function statusColor(status: TopologyNode["status"]) {
  return status === "healthy"
    ? 0x54e8a1
    : status === "degraded"
      ? 0xffc857
      : 0x52645f;
}

function labelSprite(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(4, 20, 15, .86)";
  context.roundRect(4, 4, 504, 82, 18);
  context.fill();
  context.strokeStyle = "rgba(84, 232, 161, .35)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#e8fff5";
  context.font = "600 28px Inter, system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 256, 46, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.8, 0.72, 1);
  return sprite;
}

function Scene({
  topology,
  onSelect,
}: {
  topology: HomelabTopology;
  onSelect: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03100c, 0.026);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(0, 3, 28);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x03100c, 0);
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x9fffd1, 1.25));
    const key = new THREE.PointLight(0x73ffbc, 38, 60);
    key.position.set(-6, 9, 12);
    scene.add(key);
    const fill = new THREE.PointLight(0xb8ff6a, 24, 55);
    fill.position.set(10, -8, 8);
    scene.add(fill);

    const graph = new THREE.Group();
    graph.rotation.x = -0.08;
    scene.add(graph);
    const points = new Map<string, THREE.Vector3>();
    const pickables: THREE.Mesh[] = [];
    const layerCounts = new Map<string, number>();
    const layerIndexes = new Map<string, number>();
    for (const node of topology.nodes)
      layerCounts.set(node.layer, (layerCounts.get(node.layer) ?? 0) + 1);

    for (const node of topology.nodes) {
      const index = layerIndexes.get(node.layer) ?? 0;
      layerIndexes.set(node.layer, index + 1);
      const count = layerCounts.get(node.layer) ?? 1;
      const y = (index - (count - 1) / 2) * 1.8;
      const z = Math.sin(index * 1.8 + LAYER_X[node.layer]) * 1.25;
      const point = new THREE.Vector3(LAYER_X[node.layer] ?? 0, y, z);
      points.set(node.id, point);

      const geometry =
        node.layer === "compute"
          ? new THREE.BoxGeometry(0.9, 0.9, 0.9)
          : node.layer === "apps"
            ? new THREE.IcosahedronGeometry(0.58, 1)
            : new THREE.OctahedronGeometry(0.62, 0);
      const color = statusColor(node.status);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: node.status === "healthy" ? 0.28 : 0.12,
        roughness: 0.4,
        metalness: 0.28,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(point);
      mesh.userData = { id: node.id, phase: index * 0.7 };
      graph.add(mesh);
      pickables.push(mesh);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.82, 16, 16),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
        }),
      );
      mesh.add(halo);

      const label = labelSprite(node.label);
      label.position.copy(point).add(new THREE.Vector3(0, -1.02, 0));
      graph.add(label);
    }

    for (const edge of topology.edges) {
      const source = points.get(edge.source);
      const target = points.get(edge.target);
      if (!source || !target) continue;
      const midpoint = source.clone().lerp(target, 0.5);
      midpoint.z += Math.max(0.5, source.distanceTo(target) * 0.16);
      const curve = new THREE.QuadraticBezierCurve3(source, midpoint, target);
      const geometry = new THREE.BufferGeometry().setFromPoints(
        curve.getPoints(22),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0x54e8a1,
          transparent: true,
          opacity: edge.kind === "hosts" ? 0.11 : 0.22,
        }),
      );
      graph.add(line);
    }

    const grid = new THREE.GridHelper(36, 36, 0x194c3c, 0x0b2a20);
    grid.position.y = -7;
    grid.rotation.z = 0.02;
    scene.add(grid);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let distance = 0;
    let lastX = 0;
    let lastY = 0;
    const down = (event: PointerEvent) => {
      dragging = true;
      distance = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      distance += Math.abs(dx) + Math.abs(dy);
      graph.rotation.y += dx * 0.004;
      graph.rotation.x = THREE.MathUtils.clamp(
        graph.rotation.x + dy * 0.003,
        -0.55,
        0.4,
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      if (distance > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (hit?.object.userData.id) onSelect(hit.object.userData.id);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z + event.deltaY * 0.012,
        17,
        42,
      );
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      const time = clock.getElapsedTime();
      for (const mesh of pickables) {
        const pulse = 1 + Math.sin(time * 1.8 + mesh.userData.phase) * 0.045;
        mesh.scale.setScalar(pulse);
        mesh.rotation.y += 0.003;
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("wheel", wheel);
      graph.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          if (Array.isArray(object.material))
            object.material.forEach((m) => m.dispose());
          else object.material.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [onSelect, topology]);

  return <div className="three-host" ref={hostRef} />;
}

export default function TopologyGraph() {
  const [topology, setTopology] = useState<HomelabTopology | null>(null);
  const [selectedId, setSelectedId] = useState("homeops");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetchTopology();
        if (active) {
          setTopology(next);
          setError(null);
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Topology unavailable");
      }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const selected = useMemo(
    () =>
      topology?.nodes.find((node) => node.id === selectedId) ??
      topology?.nodes[0],
    [selectedId, topology],
  );

  return (
    <main className="topology-page">
      <section className="topology-heading">
        <div>
          <p className="kicker">
            <Layers3 size={15} /> Sanitized live architecture
          </p>
          <h1>
            The whole homelab, <em>as a system.</em>
          </h1>
        </div>
        <p>
          Drag to orbit, scroll to zoom, and select a service. Node health and
          metrics are live; the connections are the deployed GitOps
          architecture. Sensitive identities and configuration are omitted.
        </p>
      </section>

      <section className="topology-workbench">
        <div className="topology-canvas-panel">
          <div className="topology-toolbar">
            <span>
              <i className={topology ? "is-live" : ""} />
              {topology ? "LIVE INVENTORY" : "CONNECTING"}
            </span>
            <small>
              <MousePointer2 size={13} /> drag · zoom · select
            </small>
          </div>
          {topology ? (
            <Scene topology={topology} onSelect={setSelectedId} />
          ) : (
            <div className="topology-loading">
              <RefreshCw className="spin" size={24} />
              <span>{error ?? "Reading sanitized Kubernetes inventory…"}</span>
            </div>
          )}
          <div className="topology-legend">
            {LAYERS.map(([id, label]) => (
              <span key={id} data-layer={id}>
                <i /> {label}
              </span>
            ))}
          </div>
        </div>

        <aside className="topology-inspector">
          {selected ? (
            <>
              <div className="inspector-head">
                <span className={`node-status status-${selected.status}`}>
                  <i /> {selected.status}
                </span>
                <small>{selected.layer}</small>
                <h2>{selected.label}</h2>
                <p>{selected.kind}</p>
              </div>
              <p className="inspector-description">{selected.description}</p>
              <div className="inspector-metrics">
                <span>
                  <Boxes size={16} />
                  <small>Ready</small>
                  <b>
                    {selected.ready}/{selected.desired}
                  </b>
                </span>
                <span>
                  <Cpu size={16} />
                  <small>CPU</small>
                  <b>
                    {selected.cpuUtilizationPct !== null
                      ? `${selected.cpuUtilizationPct}%`
                      : `${selected.cpuMillicores}m`}
                  </b>
                </span>
                <span>
                  <MemoryStick size={16} />
                  <small>Memory</small>
                  <b>
                    {selected.memoryUtilizationPct !== null
                      ? `${selected.memoryUtilizationPct}%`
                      : `${selected.memoryMiB} MiB`}
                  </b>
                </span>
                <span>
                  <GitPullRequest size={16} />
                  <small>GitOps</small>
                  <b>{selected.gitOpsSync ?? "n/a"}</b>
                </span>
              </div>
              <div className="inspector-source">
                <Activity size={15} />
                <span>
                  <b>Last observed</b>
                  <small>
                    {new Date(selected.observedAt).toLocaleTimeString()}
                  </small>
                </span>
              </div>
            </>
          ) : null}
          <div className="inspector-list">
            <strong>COMPONENTS</strong>
            {topology?.nodes.map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedId(node.id)}
                className={node.id === selected?.id ? "selected" : ""}
              >
                <i className={`status-${node.status}`} />
                <span>
                  <b>{node.label}</b>
                  <small>{node.kind}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>
      {topology && (
        <p className="topology-source">
          {topology.source} Observed{" "}
          {new Date(topology.observedAt).toLocaleString()}.
        </p>
      )}
    </main>
  );
}
