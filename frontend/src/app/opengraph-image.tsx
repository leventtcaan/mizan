import { ImageResponse } from "next/og";

// Generated Open Graph card — what a shared clarifin.xyz link looks like on
// WhatsApp/Twitter/LinkedIn. Brand teal on warm dark, wordmark + one-line value prop.
export const runtime = "edge";
export const alt = "Clarifin — See all your money in one place";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0E1F1C 0%, #11302A 55%, #176B5B 130%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "#176B5B",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ color: "#fff", fontSize: 56, fontWeight: 800, letterSpacing: -1 }}>
            Clarifin
          </div>
        </div>

        <div
          style={{
            marginTop: 48,
            color: "#fff",
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -2,
            maxWidth: 950,
          }}
        >
          See all your money in one place.
        </div>

        <div style={{ marginTop: 28, color: "rgba(255,255,255,0.72)", fontSize: 32, maxWidth: 900 }}>
          Upload a statement — spending, net worth and what to do next, in seconds.
        </div>

        <div style={{ display: "flex", marginTop: 56, gap: 14 }}>
          {["Any bank", "Any currency", "No account linking"].map((chip) => (
            <div
              key={chip}
              style={{
                padding: "12px 26px",
                borderRadius: 999,
                border: "2px solid rgba(255,255,255,0.35)",
                color: "#fff",
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
