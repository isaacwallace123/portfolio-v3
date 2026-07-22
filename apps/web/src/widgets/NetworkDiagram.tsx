"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/shared/lib/prefs";

// Interactive diagram of the four-site network. Pure SVG + CSS — every site is a
// node wired to the shared API; a session "packet" travels the wires to make the
// SSO story visible. Hovering (or focusing) a node lights up its wire. Reduced
// motion shows the same diagram, static.

const DEV = process.env.NODE_ENV === "development";

interface Node {
  id: string;
  label: string;
  sub: string;
  x: number; // center x
  y: number; // center y
  color: string;
  href?: string;
}

const NODES: Node[] = [
  {
    id: "web",
    label: "isaacwallace.dev",
    sub: "main · this site",
    x: 360,
    y: 46,
    color: "var(--lab-main)",
  },
  {
    id: "cyber",
    label: "cyberlab",
    sub: "cyber range",
    x: 120,
    y: 250,
    color: "var(--lab-cyber)",
    href: DEV ? "http://localhost:3001" : "https://cyberlab.isaacwallace.dev",
  },
  {
    id: "homelab",
    label: "homelab",
    sub: "devops · k3s",
    x: 360,
    y: 274,
    color: "var(--lab-homelab)",
    href: "https://homelab.isaacwallace.dev",
  },
  {
    id: "ailab",
    label: "ailab",
    sub: "ai systems",
    x: 600,
    y: 250,
    color: "var(--lab-ailab)",
    href: "https://ailab.isaacwallace.dev",
  },
];

const API = { x: 360, y: 152 };

const wire = (n: Node) =>
  `M ${n.x} ${n.y + (n.y < API.y ? 26 : -26)} L ${API.x} ${API.y + (n.y < API.y ? -30 : 30)}`;

export default function NetworkDiagram() {
  const [hot, setHot] = useState<string | null>(null);
  const [animate, setAnimate] = useState(false);
  const ref = useRef<SVGSVGElement>(null);

  // start the packet animation only when visible (and motion is welcome)
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !("IntersectionObserver" in window))
      return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAnimate(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 720 320"
      role="img"
      aria-label="Diagram of the portfolio network: the main site and three labs all sharing one session through api.isaacwallace.dev"
      className="h-auto w-full"
    >
      {/* wires */}
      {NODES.map((n) => {
        const lit = hot === n.id;
        return (
          <g key={`w-${n.id}`}>
            <path
              d={wire(n)}
              fill="none"
              stroke={lit ? n.color : "var(--line-2)"}
              strokeWidth={lit ? 2 : 1.5}
              style={{ transition: "stroke var(--dur-base) var(--ease-out)" }}
            />
            {animate && (
              <circle r="3.5" fill={n.color} opacity={lit ? 1 : 0.65}>
                <animateMotion
                  dur={`${2.6 + NODES.indexOf(n) * 0.45}s`}
                  repeatCount="indefinite"
                  path={wire(n)}
                  calcMode="linear"
                  keyPoints="0;1;0"
                  keyTimes="0;0.5;1"
                />
              </circle>
            )}
          </g>
        );
      })}

      {/* the shared API — the heart of the network */}
      <g>
        <rect
          x={API.x - 110}
          y={API.y - 30}
          width="220"
          height="60"
          rx="12"
          fill="var(--card)"
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
        <text
          x={API.x}
          y={API.y - 6}
          textAnchor="middle"
          fill="var(--ink)"
          style={{ font: "700 13px var(--mono)" }}
        >
          api.isaacwallace.dev
        </text>
        <text
          x={API.x}
          y={API.y + 14}
          textAnchor="middle"
          fill="var(--ink-dim)"
          style={{ font: "600 10px var(--mono)", letterSpacing: "0.08em" }}
        >
          one cookie · .isaacwallace.dev
        </text>
        {animate && (
          <circle cx={API.x - 96} cy={API.y - 16} r="3.5" fill="var(--accent)">
            <animate
              attributeName="opacity"
              values="1;0.25;1"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </circle>
        )}
        {!animate && (
          <circle
            cx={API.x - 96}
            cy={API.y - 16}
            r="3.5"
            fill="var(--accent)"
          />
        )}
      </g>

      {/* site nodes */}
      {NODES.map((n) => {
        const lit = hot === n.id;
        const W = n.id === "web" ? 210 : 150;
        const node = (
          <g
            onMouseEnter={() => setHot(n.id)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot(n.id)}
            onBlur={() => setHot(null)}
            style={{ cursor: n.href ? "pointer" : "default" }}
          >
            <rect
              x={n.x - W / 2}
              y={n.y - 26}
              width={W}
              height="52"
              rx="12"
              fill="var(--card)"
              stroke={lit ? n.color : "var(--line-2)"}
              strokeWidth={lit ? 2 : 1.5}
              style={{
                transition:
                  "stroke var(--dur-base) var(--ease-out), filter var(--dur-base) var(--ease-out)",
                filter: lit
                  ? `drop-shadow(0 6px 14px color-mix(in srgb, ${n.color} 35%, transparent))`
                  : "none",
              }}
            />
            <circle cx={n.x - W / 2 + 16} cy={n.y - 8} r="4" fill={n.color} />
            <text
              x={n.x - W / 2 + 28}
              y={n.y - 4}
              fill="var(--ink)"
              style={{ font: "700 12.5px var(--mono)" }}
            >
              {n.label}
            </text>
            <text
              x={n.x - W / 2 + 28}
              y={n.y + 14}
              fill="var(--ink-dim)"
              style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em" }}
            >
              {n.sub}
            </text>
          </g>
        );
        return n.href ? (
          <a key={n.id} href={n.href} aria-label={`${n.label} — ${n.sub}`}>
            {node}
          </a>
        ) : (
          <g key={n.id}>{node}</g>
        );
      })}
    </svg>
  );
}
