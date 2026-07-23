"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type LabMotionVariant = "cyberlab" | "homelab" | "ailab";

const SCENE_CONFIG: Record<
  LabMotionVariant,
  {
    particles: number;
    spread: [number, number, number];
    shape: "octahedron" | "icosahedron" | "neural";
  }
> = {
  cyberlab: {
    particles: 82,
    spread: [8.6, 5.2, 4.2],
    shape: "octahedron",
  },
  homelab: {
    particles: 96,
    spread: [8.8, 5.6, 4.6],
    shape: "icosahedron",
  },
  ailab: {
    particles: 54,
    spread: [7.4, 4.6, 2.8],
    shape: "neural",
  },
};

function prefersLessMotion() {
  return (
    document.documentElement.hasAttribute("data-reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function createSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function readSceneColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function LabAmbientScene({ variant }: { variant: LabMotionVariant }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const config = SCENE_CONFIG[variant];
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        canvas,
        powerPreference: "low-power",
      });
    } catch {
      canvas.hidden = true;
      return;
    }
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 30);
    camera.position.set(0, 0, 7.4);

    const field = new THREE.Group();
    field.position.x = 1.6;
    scene.add(field);

    const random = createSeededRandom(
      variant === "cyberlab" ? 2026 : variant === "homelab" ? 7331 : 9001,
    );
    const positions = new Float32Array(config.particles * 3);
    for (let index = 0; index < config.particles; index += 1) {
      positions[index * 3] = (random() - 0.5) * config.spread[0];
      positions[index * 3 + 1] = (random() - 0.5) * config.spread[1];
      positions[index * 3 + 2] = (random() - 0.5) * config.spread[2];
    }

    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const particlesMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      opacity: 0.34,
      size: variant === "ailab" ? 0.036 : 0.031,
      sizeAttenuation: true,
      transparent: true,
    });
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    field.add(particles);

    const shapeGeometry =
      config.shape === "neural"
        ? new THREE.IcosahedronGeometry(0.66, 1)
        : config.shape === "icosahedron"
          ? new THREE.IcosahedronGeometry(1.22, 1)
          : new THREE.OctahedronGeometry(1.28, 1);
    const wireGeometry = new THREE.WireframeGeometry(shapeGeometry);
    const wireMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.2,
      transparent: true,
    });
    const core = new THREE.LineSegments(wireGeometry, wireMaterial);
    core.position.set(
      variant === "ailab" ? 1.15 : 1.4,
      variant === "cyberlab" ? -0.15 : 0.1,
      -0.2,
    );
    core.rotation.set(0.35, 0.25, -0.12);
    field.add(core);

    const orbitRadius = variant === "ailab" ? 1.24 : 1.72;
    const orbitGeometry = new THREE.RingGeometry(
      orbitRadius,
      orbitRadius + 0.012,
      72,
    );
    const orbitMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      opacity: 0.11,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
    orbit.position.copy(core.position);
    orbit.rotation.set(1.12, 0.12, 0.32);
    field.add(orbit);

    const neuralGroup = new THREE.Group();
    neuralGroup.position.copy(core.position);
    field.add(neuralGroup);

    const neuralNodePositions: number[] = [];
    const neuralLayers: THREE.Vector3[][] = [];
    const layerCounts = [3, 5, 5, 3];
    layerCounts.forEach((count, layerIndex) => {
      const layer: THREE.Vector3[] = [];
      for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
        const y = count === 1 ? 0 : (nodeIndex / (count - 1) - 0.5) * 2.25;
        const node = new THREE.Vector3(
          (layerIndex / (layerCounts.length - 1) - 0.5) * 2.5,
          y,
          Math.sin(layerIndex * 1.7 + nodeIndex * 0.9) * 0.22,
        );
        layer.push(node);
        neuralNodePositions.push(node.x, node.y, node.z);
      }
      neuralLayers.push(layer);
    });

    const neuralSegments: number[] = [];
    const signalPaths: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (
      let layerIndex = 0;
      layerIndex < neuralLayers.length - 1;
      layerIndex += 1
    ) {
      const fromLayer = neuralLayers[layerIndex];
      const toLayer = neuralLayers[layerIndex + 1];
      fromLayer.forEach((from, nodeIndex) => {
        const targets = [
          nodeIndex % toLayer.length,
          (nodeIndex + layerIndex + 2) % toLayer.length,
        ];
        targets.forEach((targetIndex, targetOffset) => {
          const to = toLayer[targetIndex];
          neuralSegments.push(from.x, from.y, from.z, to.x, to.y, to.z);
          if (targetOffset === 0) signalPaths.push([from, to]);
        });
      });
    }

    const neuralNodesGeometry = new THREE.BufferGeometry();
    neuralNodesGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(neuralNodePositions, 3),
    );
    const neuralNodesMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      opacity: variant === "ailab" ? 0.72 : 0,
      size: 0.085,
      sizeAttenuation: true,
      transparent: true,
    });
    const neuralNodes = new THREE.Points(
      neuralNodesGeometry,
      neuralNodesMaterial,
    );
    neuralGroup.add(neuralNodes);

    const neuralLinesGeometry = new THREE.BufferGeometry();
    neuralLinesGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(neuralSegments, 3),
    );
    const neuralLinesMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: variant === "ailab" ? 0.14 : 0,
      transparent: true,
    });
    const neuralLines = new THREE.LineSegments(
      neuralLinesGeometry,
      neuralLinesMaterial,
    );
    neuralGroup.add(neuralLines);

    const signalGeometry = new THREE.SphereGeometry(0.045, 8, 8);
    const signalMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      opacity: variant === "ailab" ? 0.9 : 0,
      transparent: true,
    });
    const signals = signalPaths.slice(0, 5).map((_, index) => {
      const signal = new THREE.Mesh(signalGeometry, signalMaterial);
      signal.userData.offset = index / 5;
      neuralGroup.add(signal);
      return signal;
    });

    const updateColors = () => {
      const primary = new THREE.Color(
        readSceneColor("--lab-motion-primary", "#ff9450"),
      );
      const secondary = new THREE.Color(
        readSceneColor("--lab-motion-secondary", "#ffd74a"),
      );
      particlesMaterial.color.copy(primary);
      wireMaterial.color.copy(secondary);
      orbitMaterial.color.copy(primary);
      neuralNodesMaterial.color.copy(primary);
      neuralLinesMaterial.color.copy(secondary);
      signalMaterial.color.copy(secondary);
    };
    updateColors();

    let pointerX = 0;
    let pointerY = 0;
    let easedX = 0;
    let easedY = 0;
    let scrollProgress = 0;
    let active = document.visibilityState === "visible";
    let inView = true;
    let reduced = prefersLessMotion();
    let frame = 0;
    let lastRender = 0;

    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    resize();

    const render = (time = 0) => {
      easedX += (pointerX - easedX) * 0.045;
      easedY += (pointerY - easedY) * 0.045;
      camera.position.x = easedX * 0.34;
      camera.position.y = -easedY * 0.22;
      camera.lookAt(0.7, 0, 0);

      if (!reduced) {
        const seconds = time * 0.001;
        field.rotation.y = seconds * 0.025 + scrollProgress * 0.42;
        particles.rotation.z = seconds * 0.014;
        core.rotation.y = 0.25 + seconds * 0.09 + easedX * 0.08;
        core.rotation.x = 0.35 + seconds * 0.045 - easedY * 0.06;
        orbit.rotation.z = 0.32 - seconds * 0.055;
        neuralGroup.rotation.y = Math.sin(seconds * 0.22) * 0.12;
        neuralGroup.rotation.x = Math.cos(seconds * 0.18) * 0.035;
        signals.forEach((signal, index) => {
          const path = signalPaths[index];
          const progress = (seconds * 0.16 + signal.userData.offset) % 1;
          signal.position.lerpVectors(path[0], path[1], progress);
          signal.scale.setScalar(0.8 + Math.sin(progress * Math.PI) * 0.7);
        });
      }

      renderer.render(scene, camera);
    };

    const animate = (time: number) => {
      if (!active || !inView || reduced) {
        frame = 0;
        return;
      }
      if (time - lastRender >= 32) {
        render(time);
        lastRender = time;
      }
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      if (!frame && active && inView && !reduced) {
        frame = window.requestAnimationFrame(animate);
      } else if (reduced) {
        render();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };
    const onScroll = () => {
      const distance =
        document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress =
        distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
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
      reduced = prefersLessMotion();
      updateColors();
      if (reduced && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      start();
    };

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rootObserver = new MutationObserver(onPreferenceChange);
    rootObserver.observe(document.documentElement, {
      attributeFilter: ["data-reduce-motion", "data-theme"],
      attributes: true,
    });
    const viewObserver = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? true;
      if (!inView && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      start();
    });
    viewObserver.observe(canvas);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", onPreferenceChange);

    onScroll();
    render();
    start();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewObserver.disconnect();
      rootObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      media.removeEventListener("change", onPreferenceChange);
      particlesGeometry.dispose();
      particlesMaterial.dispose();
      shapeGeometry.dispose();
      wireGeometry.dispose();
      wireMaterial.dispose();
      orbitGeometry.dispose();
      orbitMaterial.dispose();
      neuralNodesGeometry.dispose();
      neuralNodesMaterial.dispose();
      neuralLinesGeometry.dispose();
      neuralLinesMaterial.dispose();
      signalGeometry.dispose();
      signalMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      className={`lab-ambient-scene lab-ambient-${variant}`}
      aria-hidden="true"
    />
  );
}

export function LabMotion({
  variant,
  ambient = true,
}: {
  variant: LabMotionVariant;
  ambient?: boolean;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-lab-reveal]"),
    );
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = prefersLessMotion();

    const reveal = (element: HTMLElement) => {
      if (element.dataset.labVisible === "true") return;
      element.dataset.labVisible = "true";
      if (reduced) return;

      const delay = Number(element.dataset.labDelay ?? 0);
      const restingTransform = getComputedStyle(element).transform;
      const resting =
        restingTransform === "none" ? "translate3d(0, 0, 0)" : restingTransform;
      element.animate(
        [
          {
            opacity: 0,
            transform: `${resting} translate3d(0, 32px, 0) scale(0.985)`,
          },
          { opacity: 1, transform: resting },
        ],
        {
          delay,
          duration: 760,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        },
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -9% 0px", threshold: 0.08 },
    );
    elements.forEach((element) => observer.observe(element));

    let scrollFrame = 0;
    let pointerFrame = 0;
    const updateScroll = () => {
      scrollFrame = 0;
      const distance = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(1, Math.max(0, window.scrollY / distance));
      root.style.setProperty("--lab-scroll", progress.toFixed(4));
      root.style.setProperty(
        "--lab-scroll-shift",
        `${Math.round(progress * -26)}px`,
      );
    };
    const onScroll = () => {
      if (!scrollFrame)
        scrollFrame = window.requestAnimationFrame(updateScroll);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerFrame || reduced) return;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0;
        const x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
        const y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
        root.style.setProperty("--lab-pointer-x", `${(x * 9).toFixed(2)}px`);
        root.style.setProperty("--lab-pointer-y", `${(y * 7).toFixed(2)}px`);
        root.style.setProperty(
          "--lab-pointer-rx",
          `${(-y * 0.8).toFixed(2)}deg`,
        );
        root.style.setProperty(
          "--lab-pointer-ry",
          `${(x * 1.1).toFixed(2)}deg`,
        );
      });
    };
    const onPreferenceChange = () => {
      reduced = prefersLessMotion();
      if (reduced) {
        elements.forEach(reveal);
        root.style.setProperty("--lab-pointer-x", "0px");
        root.style.setProperty("--lab-pointer-y", "0px");
        root.style.setProperty("--lab-pointer-rx", "0deg");
        root.style.setProperty("--lab-pointer-ry", "0deg");
      }
    };
    const rootObserver = new MutationObserver(onPreferenceChange);
    rootObserver.observe(root, {
      attributeFilter: ["data-reduce-motion"],
      attributes: true,
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    media.addEventListener("change", onPreferenceChange);
    updateScroll();

    return () => {
      observer.disconnect();
      rootObserver.disconnect();
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      media.removeEventListener("change", onPreferenceChange);
      root.style.removeProperty("--lab-scroll");
      root.style.removeProperty("--lab-scroll-shift");
      root.style.removeProperty("--lab-pointer-x");
      root.style.removeProperty("--lab-pointer-y");
      root.style.removeProperty("--lab-pointer-rx");
      root.style.removeProperty("--lab-pointer-ry");
    };
  }, []);

  return (
    <>
      <div className="lab-scroll-progress" aria-hidden="true" />
      {ambient && <LabAmbientScene variant={variant} />}
    </>
  );
}
