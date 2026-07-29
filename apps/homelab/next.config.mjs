import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const isDev = process.env.NODE_ENV === "development";

// Cross-origin destinations the browser is actually allowed to reach. Everything this page does with
// the cluster is same-origin (/api/live/*, which proxies server-side with a key the browser never
// holds); the sibling origins are only auth and the shared application API.
const AUTH_ORIGIN =
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  (isDev ? "http://localhost:5170" : "https://auth.isaacwallace.dev");
const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL ??
  (isDev ? "http://localhost:5180" : "https://api.isaacwallace.dev");

// Content-Security-Policy.
//
// script-src carries 'unsafe-inline' because the theme and preference boot scripts run inline in
// <head> — they have to, or the page flashes the wrong theme before hydration. Moving to nonces
// means reading headers() in the root layout, which makes every route dynamic; that trade is not
// worth it here, since this app renders no user-authored content and has no XSS sink to speak of.
// The rest of the policy is strict, and the parts that matter most on a page with real provisioning
// buttons — frame-ancestors, object-src, base-uri, form-action — are locked shut.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind and the SVG flowchart both set style attributes at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${AUTH_ORIGIN} ${API_ORIGIN}${isDev ? " ws: http://localhost:*" : ""}`,
  // No plugins, no embedded documents, and this page is never framed.
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  // A dangling <base> is how an injected tag would retarget every relative URL on the page.
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Cross-origin isolation for the window itself: a popup opener cannot reach into this page, and
  // another origin cannot read it into a canvas or a document.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typedRoutes: true,
  transpilePackages: ["@iw/core", "@iw/ui", "@iw/lab-runtime"],
  outputFileTracingRoot: repoRoot,
  // Fingerprinted build assets are immutable; nothing else here is cacheable at the edge.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The control-plane routes are never cacheable and never indexable. The individual routes set
      // this too — this is the backstop that survives someone adding a route and forgetting.
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
