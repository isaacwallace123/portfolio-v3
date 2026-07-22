"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { prefersReducedMotion } from "@/shared/lib/prefs";

// The hero's ambient motion — a flowing line-field, not an object. Thin ribbons
// spread across a ground plane and undulate with layered waves, receding toward
// a horizon where scene fog melts them into the paper. A few lines carry the lab
// colours; the cursor lifts a gentle swell beneath it. Raw three.js (no r3f) to
// stay lean; client-only; reduced motion → one calm static frame.

const LAB = [0x0891b2, 0x059669, 0x7c3aed]; // cyber / homelab / ailab accents
const BASE = 0x3b5bdb; // the network indigo

// The far ribbons dissolve into the page's ground colour via fog. That colour is the theme's
// ground (`--paper`), read live — otherwise dark mode fades them toward a light haze over a dark
// page (visible banding + a seam against the scrim).
function groundColor(): THREE.Color {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--paper")
    .trim();
  return new THREE.Color(v || "#faf9f6");
}

const LINES = 30; // ribbons receding into depth
const SEG = 150; // segments per ribbon
const X0 = -40;
const X1 = 40;
const Z_NEAR = 8;
const Z_FAR = -64;

// Cheap pre-flight: can this browser actually make a WebGL context? Some
// environments (hardware acceleration off, headless/RDP GPUs, hardened Firefox)
// fail context creation — three.js would console.error loudly. Probe with a
// throwaway canvas first and bail quietly if it can't; the hero then just shows
// its CSS background instead of the ribbon field.
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export default function HeroScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof window === "undefined") return;
    if (!webglAvailable()) return; // no WebGL → static CSS background, no errors

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL → the section just shows its CSS background
    }

    const reduce = prefersReducedMotion();
    const scene = new THREE.Scene();
    // fog in the ground colour: far ribbons dissolve into the page — a seamless horizon in either theme
    const fog = new THREE.Fog(groundColor(), 34, 84);
    scene.fog = fog;
    // follow theme switches so the horizon re-tints without a reload
    const themeObserver = new MutationObserver(() =>
      fog.color.copy(groundColor()),
    );
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    camera.position.set(0, 8.5, 26);
    camera.lookAt(0, -1, -6);

    const size = () => ({
      w: mount.clientWidth || 1,
      h: mount.clientHeight || 1,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    {
      const { w, h } = size();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    mount.appendChild(renderer.domElement);

    // one ribbon per depth row; keep its buffer + base params to animate in place
    type Ribbon = { z: number; geo: THREE.BufferGeometry; arr: Float32Array };
    const ribbons: Ribbon[] = [];
    const group = new THREE.Group();

    for (let i = 0; i < LINES; i++) {
      const f = i / (LINES - 1);
      const z = Z_NEAR + (Z_FAR - Z_NEAR) * f;
      const arr = new Float32Array((SEG + 1) * 3);
      for (let s = 0; s <= SEG; s++) {
        const x = X0 + (X1 - X0) * (s / SEG);
        arr[s * 3] = x;
        arr[s * 3 + 1] = 0;
        arr[s * 3 + 2] = z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));

      // most ribbons are the network indigo; a few carry a lab accent
      const hex = i % 7 === 3 ? LAB[((i / 7) % LAB.length) | 0] : BASE;
      const mat = new THREE.LineBasicMaterial({
        color: hex,
        transparent: true,
        // nearer ribbons a touch stronger; all quite faint on the light ground
        opacity: 0.1 + 0.28 * (1 - f),
      });
      const line = new THREE.Line(geo, mat);
      group.add(line);
      ribbons.push({ z, geo, arr });
    }
    scene.add(group);

    // ── cursor swell ──────────────────────────────────────────────────────────
    const cursor = { x: 0, active: 0 };
    const onMove = (e: MouseEvent) => {
      const r = mount.getBoundingClientRect();
      cursor.x = ((e.clientX - r.left) / r.width - 0.5) * (X1 - X0);
      cursor.active = 1;
    };
    const onLeave = () => (cursor.active = 0);
    if (!reduce) {
      window.addEventListener("mousemove", onMove);
      mount.addEventListener("mouseleave", onLeave);
    }

    const onResize = () => {
      const { w, h } = size();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // height field: layered travelling waves, damped toward the far distance
    const wave = (x: number, z: number, t: number) => {
      const damp = 0.5 + 0.5 * ((z - Z_FAR) / (Z_NEAR - Z_FAR)); // taller up close
      let y =
        0.9 * Math.sin(0.24 * x + t * 0.8 + z * 0.12) +
        0.5 * Math.sin(0.5 * x - t * 0.55 + z * 0.22) +
        0.35 * Math.sin(0.12 * x + t * 0.32 - z * 0.08);
      if (cursor.active) {
        const d = x - cursor.x;
        y += 1.6 * Math.exp(-(d * d) / 26); // a soft swell under the cursor
      }
      return y * 1.15 * damp;
    };

    const build = (t: number) => {
      for (const rb of ribbons) {
        for (let s = 0; s <= SEG; s++) {
          rb.arr[s * 3 + 1] = wave(rb.arr[s * 3], rb.z, t);
        }
        rb.geo.attributes.position.needsUpdate = true;
      }
    };

    let raf = 0;
    const clock = new THREE.Clock();
    const render = () => renderer.render(scene, camera);

    if (reduce) {
      build(0);
      render();
    } else {
      const animate = () => {
        build(clock.getElapsedTime());
        render();
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
    }

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener("mousemove", onMove);
      mount.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      ribbons.forEach((r) => r.geo.dispose());
      (group.children as THREE.Line[]).forEach((l) =>
        (l.material as THREE.Material).dispose(),
      );
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
    />
  );
}
