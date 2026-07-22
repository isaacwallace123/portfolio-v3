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
          background: "#faf9f6",
          color: "#191b1f",
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
              color: "#c23b3b",
              fontWeight: 700,
            }}
          >
            fatal error
          </p>
          <h1 style={{ fontSize: 22, margin: "12px 0 8px" }}>
            isaacwallace.dev crashed
          </h1>
          <p style={{ color: "#575c66", fontSize: 14, maxWidth: 380 }}>
            The page failed before it could even dress itself.
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
              background: "#191b1f",
              color: "#faf9f6",
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
