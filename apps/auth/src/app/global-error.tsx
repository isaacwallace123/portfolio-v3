"use client";

// Last-resort boundary: replaces the ROOT layout when even it fails, so this
// must render its own <html>/<body> and style itself without globals.css.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#090a10",
          color: "#e9ebf5",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "#fb6a6a",
              fontWeight: 700,
            }}
          >
            fatal error
          </p>
          <h1 style={{ fontSize: 22, margin: "12px 0 8px" }}>
            auth.isaacwallace.dev crashed
          </h1>
          <p style={{ color: "#9298ad", fontSize: 14, maxWidth: 380 }}>
            The page failed before it could even dress itself. Your account is
            unaffected.
            {error.digest ? ` (ref ${error.digest})` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              height: 44,
              padding: "0 24px",
              borderRadius: 8,
              border: 0,
              background: "#6675ff",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
