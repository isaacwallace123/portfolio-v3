"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Cpu, Gauge, Route } from "lucide-react";
import * as THREE from "three";
import type { RunStatus } from "@iw/lab-runtime";

type RoutingMode = "balanced" | "quality" | "speed";

const ROUTING_COPY: Record<
  RoutingMode,
  { label: string; primary: string; fast: string }
> = {
  balanced: { label: "Balanced", primary: "52%", fast: "48%" },
  quality: { label: "Quality", primary: "82%", fast: "18%" },
  speed: { label: "Speed", primary: "24%", fast: "76%" },
};

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function motionReduced() {
  return (
    document.documentElement.hasAttribute("data-reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function ModelObservatory({ status }: { status: RunStatus }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const primaryLabelRef = useRef<HTMLDivElement>(null);
  const routerLabelRef = useRef<HTMLDivElement>(null);
  const fastLabelRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<RoutingMode>("balanced");
  const statusRef = useRef(status);
  const [mode, setMode] = useState<RoutingMode>("balanced");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        powerPreference: "high-performance",
      });
    } catch {
      canvas.hidden = true;
      return;
    }

    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30);
    camera.position.set(0, 0.3, 6.4);

    const world = new THREE.Group();
    world.rotation.x = -0.08;
    scene.add(world);

    const primary = new THREE.Color(cssColor("--violet", "#9e78ff"));
    const fast = new THREE.Color(cssColor("--cyan", "#55e6ff"));
    const evaluator = new THREE.Color(cssColor("--pink", "#f071d0"));

    const grid = new THREE.GridHelper(7.5, 18, primary, primary);
    grid.position.y = -1.52;
    grid.rotation.z = 0.05;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.opacity = 0.08;
    gridMaterial.transparent = true;
    world.add(grid);

    const starPositions = new Float32Array(72 * 3);
    for (let index = 0; index < 72; index += 1) {
      starPositions[index * 3] =
        (Math.sin(index * 18.17) * 0.5 + 0.5) * 7 - 3.5;
      starPositions[index * 3 + 1] =
        (Math.sin(index * 7.13 + 2.4) * 0.5 + 0.5) * 4.2 - 2.1;
      starPositions[index * 3 + 2] =
        (Math.sin(index * 3.91 + 0.8) * 0.5 + 0.5) * 2 - 1;
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    const starsMaterial = new THREE.PointsMaterial({
      color: primary,
      opacity: 0.22,
      size: 0.026,
      transparent: true,
    });
    world.add(new THREE.Points(starsGeometry, starsMaterial));

    const primaryPosition = new THREE.Vector3(-1.78, 0.65, 0);
    const routerPosition = new THREE.Vector3(0, 0, 0.2);
    const fastPosition = new THREE.Vector3(1.78, -0.55, 0);

    const workerGeometry = new THREE.IcosahedronGeometry(0.28, 1);
    const primaryMaterial = new THREE.MeshBasicMaterial({
      color: primary,
      opacity: 0.72,
      transparent: true,
      wireframe: true,
    });
    const fastMaterial = new THREE.MeshBasicMaterial({
      color: fast,
      opacity: 0.72,
      transparent: true,
      wireframe: true,
    });
    const primaryWorker = new THREE.Mesh(workerGeometry, primaryMaterial);
    primaryWorker.position.copy(primaryPosition);
    primaryWorker.userData.route = "quality";
    const fastWorker = new THREE.Mesh(workerGeometry, fastMaterial);
    fastWorker.position.copy(fastPosition);
    fastWorker.userData.route = "speed";
    world.add(primaryWorker, fastWorker);

    const workerRingGeometry = new THREE.TorusGeometry(0.44, 0.012, 6, 52);
    const primaryRingMaterial = new THREE.MeshBasicMaterial({
      color: primary,
      opacity: 0.3,
      transparent: true,
    });
    const fastRingMaterial = new THREE.MeshBasicMaterial({
      color: fast,
      opacity: 0.3,
      transparent: true,
    });
    const primaryRing = new THREE.Mesh(workerRingGeometry, primaryRingMaterial);
    primaryRing.position.copy(primaryPosition);
    const fastRing = new THREE.Mesh(workerRingGeometry, fastRingMaterial);
    fastRing.position.copy(fastPosition);
    world.add(primaryRing, fastRing);

    const shellGeometry = new THREE.IcosahedronGeometry(0.72, 2);
    const shellMaterial = new THREE.MeshBasicMaterial({
      color: evaluator,
      opacity: 0.24,
      transparent: true,
      wireframe: true,
    });
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.position.copy(routerPosition);
    world.add(shell);

    const coreGeometry = new THREE.OctahedronGeometry(0.32, 1);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: evaluator,
      opacity: 0.84,
      transparent: true,
      wireframe: true,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.copy(routerPosition);
    world.add(core);

    const coreRingGeometry = new THREE.TorusGeometry(0.98, 0.012, 6, 72);
    const coreRingMaterial = new THREE.MeshBasicMaterial({
      color: primary,
      opacity: 0.2,
      transparent: true,
    });
    const coreRing = new THREE.Mesh(coreRingGeometry, coreRingMaterial);
    coreRing.position.copy(routerPosition);
    coreRing.rotation.x = 1.05;
    world.add(coreRing);

    const paths = [
      new THREE.CatmullRomCurve3([
        primaryPosition,
        new THREE.Vector3(-1.1, 0.9, 0.28),
        new THREE.Vector3(-0.55, 0.36, 0.12),
        routerPosition,
      ]),
      new THREE.CatmullRomCurve3([
        fastPosition,
        new THREE.Vector3(1.15, -0.9, 0.2),
        new THREE.Vector3(0.58, -0.34, 0.08),
        routerPosition,
      ]),
    ];
    const pathMaterials = [
      new THREE.LineBasicMaterial({
        color: primary,
        opacity: 0.34,
        transparent: true,
      }),
      new THREE.LineBasicMaterial({
        color: fast,
        opacity: 0.34,
        transparent: true,
      }),
    ];
    paths.forEach((path, index) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        path.getPoints(56),
      );
      const line = new THREE.Line(geometry, pathMaterials[index]);
      world.add(line);
    });

    const pulseGeometry = new THREE.SphereGeometry(0.052, 10, 10);
    const pulseMaterials = [
      new THREE.MeshBasicMaterial({ color: primary }),
      new THREE.MeshBasicMaterial({ color: fast }),
    ];
    const pulses = paths.flatMap((path, pathIndex) =>
      [0, 0.34, 0.68].map((offset) => {
        const pulse = new THREE.Mesh(pulseGeometry, pulseMaterials[pathIndex]);
        pulse.userData.path = pathIndex;
        pulse.userData.offset = offset;
        world.add(pulse);
        return pulse;
      }),
    );

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(9, 9);
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let hovered: THREE.Mesh | null = null;
    let active = document.visibilityState === "visible";
    let inView = true;
    let reduced = motionReduced();
    let frame = 0;
    let lastRender = 0;

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };

    const projectLabel = (
      element: HTMLDivElement | null,
      object: THREE.Object3D,
      offsetX: number,
      offsetY: number,
    ) => {
      if (!element) return;
      const projected = object.getWorldPosition(new THREE.Vector3());
      projected.project(camera);
      const { width, height } = host.getBoundingClientRect();
      element.style.transform = `translate3d(${projected.x * width * 0.5 + width * 0.5 + offsetX}px, ${-projected.y * height * 0.5 + height * 0.5 + offsetY}px, 0)`;
    };

    const render = (time = 0) => {
      const seconds = time * 0.001;
      pointerX += (pointerTargetX - pointerX) * 0.06;
      pointerY += (pointerTargetY - pointerY) * 0.06;
      world.rotation.y = pointerX * 0.12;
      world.rotation.x = -0.08 - pointerY * 0.07;

      const selectedMode = modeRef.current;
      const primaryWeight =
        selectedMode === "quality" ? 1 : selectedMode === "speed" ? 0.32 : 0.72;
      const fastWeight =
        selectedMode === "speed" ? 1 : selectedMode === "quality" ? 0.32 : 0.72;
      pathMaterials[0].opacity = 0.18 + primaryWeight * 0.42;
      pathMaterials[1].opacity = 0.18 + fastWeight * 0.42;
      primaryMaterial.opacity = 0.36 + primaryWeight * 0.5;
      fastMaterial.opacity = 0.36 + fastWeight * 0.5;

      if (!reduced) {
        const running = statusRef.current === "running";
        const speed = running ? 0.34 : 0.13;
        shell.rotation.y = seconds * 0.16;
        shell.rotation.x = 0.28 + Math.sin(seconds * 0.35) * 0.08;
        core.rotation.x = -seconds * 0.3;
        core.rotation.y = seconds * 0.42;
        coreRing.rotation.z = seconds * 0.14;
        primaryWorker.rotation.y = seconds * 0.3;
        fastWorker.rotation.x = -seconds * 0.26;
        primaryRing.rotation.z = seconds * 0.18;
        fastRing.rotation.z = -seconds * 0.22;

        pulses.forEach((pulse) => {
          const pathIndex = pulse.userData.path as number;
          const routeWeight = pathIndex === 0 ? primaryWeight : fastWeight;
          const progress =
            (seconds * speed * (0.72 + routeWeight * 0.42) +
              (pulse.userData.offset as number)) %
            1;
          pulse.position.copy(paths[pathIndex].getPoint(progress));
          pulse.scale.setScalar(0.65 + routeWeight * 0.65);
        });
      } else {
        pulses.forEach((pulse) => {
          const pathIndex = pulse.userData.path as number;
          pulse.position.copy(
            paths[pathIndex].getPoint(pulse.userData.offset as number),
          );
        });
      }

      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        [primaryWorker, fastWorker],
        false,
      )[0];
      hovered = (hit?.object as THREE.Mesh | undefined) ?? null;
      canvas.style.cursor = hovered ? "pointer" : "grab";
      primaryWorker.scale.setScalar(
        primaryWorker === hovered ? 1.28 : 1 + primaryWeight * 0.08,
      );
      fastWorker.scale.setScalar(
        fastWorker === hovered ? 1.28 : 1 + fastWeight * 0.08,
      );

      camera.updateMatrixWorld();
      world.updateMatrixWorld();
      projectLabel(primaryLabelRef.current, primaryWorker, -55, -66);
      projectLabel(routerLabelRef.current, shell, -53, 58);
      projectLabel(fastLabelRef.current, fastWorker, -54, 30);
      renderer.render(scene, camera);
    };

    const animate = (time: number) => {
      if (!active || !inView) {
        frame = 0;
        return;
      }
      if (time - lastRender >= 22) {
        render(time);
        lastRender = time;
      }
      frame = window.requestAnimationFrame(animate);
    };
    const start = () => {
      if (!frame && active && inView) {
        frame = window.requestAnimationFrame(animate);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerTargetX =
        ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 2;
      pointerTargetY =
        ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5) * 2;
      pointer.set(pointerTargetX, -pointerTargetY);
    };
    const onPointerLeave = () => {
      pointerTargetX = 0;
      pointerTargetY = 0;
      pointer.set(9, 9);
    };
    const onClick = () => {
      const route = hovered?.userData.route as RoutingMode | undefined;
      if (route) setMode(route);
    };
    const onVisibility = () => {
      active = document.visibilityState === "visible";
      if (!active && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      start();
    };
    const onPreferenceChange = () => {
      reduced = motionReduced();
      render();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const viewObserver = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true;
      if (!inView && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      start();
    });
    viewObserver.observe(host);
    const preferenceObserver = new MutationObserver(onPreferenceChange);
    preferenceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reduce-motion", "data-theme"],
    });

    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);
    motionMedia.addEventListener("change", onPreferenceChange);
    resize();
    render();
    start();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      preferenceObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
      motionMedia.removeEventListener("change", onPreferenceChange);

      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Points
        ) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          objectMaterials.forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  const route = ROUTING_COPY[mode];
  const stateLabel =
    status === "running"
      ? "Routing live"
      : status === "complete"
        ? "Run complete"
        : status === "queued" || status === "provisioning"
          ? "Warming workers"
          : "Ready";

  return (
    <div
      ref={hostRef}
      className="hero-model-stack model-observatory"
      data-lab-reveal
      data-lab-delay="120"
    >
      <canvas
        ref={canvasRef}
        className="model-observatory-canvas"
        aria-label="Interactive visualization of the local model router and two GPU workers"
      />

      <header className="model-observatory-head">
        <span>
          <Route size={13} /> Model router / live topology
        </span>
        <span className="model-observatory-state">
          <i /> {stateLabel}
        </span>
      </header>

      <div ref={primaryLabelRef} className="model-node-label label-primary">
        <span>B50 · primary</span>
        <b>local-primary</b>
        <small>{route.primary} traffic · 31.4 tok/s</small>
      </div>
      <div ref={routerLabelRef} className="model-node-label label-router">
        <span>Evaluator</span>
        <b>model router</b>
        <small>{route.label} policy</small>
      </div>
      <div ref={fastLabelRef} className="model-node-label label-fast">
        <span>B580 · fast</span>
        <b>local-fast</b>
        <small>{route.fast} traffic · 38.9 tok/s</small>
      </div>

      <footer className="model-observatory-controls">
        <div>
          <Activity size={13} />
          <span>Click a worker or choose a routing policy</span>
        </div>
        <div className="route-modes" aria-label="Model routing policy">
          {(["balanced", "quality", "speed"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item === "quality" ? (
                <Cpu size={12} />
              ) : item === "speed" ? (
                <Gauge size={12} />
              ) : (
                <Route size={12} />
              )}
              {ROUTING_COPY[item].label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
