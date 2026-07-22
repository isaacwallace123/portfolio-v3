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
          background: "#070b10",
          color: "#d7e2ee",
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
              color: "#ff5d7d",
              fontWeight: 700,
            }}
          >
            fatal · console down
          </p>
          <h1 style={{ fontSize: 22, margin: "12px 0 8px" }}>
            cyberlab crashed
          </h1>
          <p style={{ color: "#8ea1b5", fontSize: 14, maxWidth: 380 }}>
            The console failed before it could even paint. The range itself is
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
              border: "1px solid #2b6b78",
              background: "#123640",
              color: "#9fe6f2",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Reload console
          </button>
        </div>
      </body>
    </html>
  );
}
