import type { ScreenshotAnnotation } from "@/lib/widget-types";

/**
 * Renders the stored vector marks over the screenshot (PULSE-401).
 *
 * One SVG with a viewBox in the capture's own pixel space, which is the space
 * the marks are stored in — so nothing has to be converted to percentages and
 * everything stays aligned at any display width. Appearance mirrors the
 * widget's canvas painter so the overlay sits exactly on the marks already
 * baked into the exported PNG.
 */
export function AnnotationOverlay({
  annotations,
  natural,
}: {
  annotations: ScreenshotAnnotation[];
  natural: { w: number; h: number };
}) {
  const highlights = annotations.filter((a) => a.kind === "highlight");

  return (
    <svg
      viewBox={`0 0 ${natural.w} ${natural.h}`}
      preserveAspectRatio="none"
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      {/* One even-odd path dims everything outside every highlight at once. */}
      {highlights.length > 0 && (
        <path
          fillRule="evenodd"
          fill="rgba(0,0,0,0.45)"
          d={
            `M0 0H${natural.w}V${natural.h}H0Z` +
            highlights.map((r) => `M${r.x} ${r.y}H${r.x + r.w}V${r.y + r.h}H${r.x}Z`).join("")
          }
        />
      )}
      {highlights.map((r, i) => (
        <rect
          key={`hl-${i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="none"
          stroke="#5e6ad2"
          strokeWidth={3}
        />
      ))}

      {annotations.map((a, i) => (
        <AnnotationMark key={i} annotation={a} />
      ))}

      {/* Redactions last: a hide must never end up underneath another mark. */}
      {annotations.map((a, i) =>
        a.kind === "hide" ? (
          <rect key={`hide-${i}`} x={a.x} y={a.y} width={a.w} height={a.h} fill="#000000" />
        ) : null
      )}
    </svg>
  );
}

/** Head length scales with the stroke, matching the widget's painter. */
function arrowHead(a: Extract<ScreenshotAnnotation, { kind: "arrow" }>): string {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const length = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const head = Math.min(Math.max(a.strokeWidth * 3.4, 12), length);
  const spread = 0.42;
  const p = (offset: number) =>
    `${a.x2 - Math.cos(angle + offset) * head} ${a.y2 - Math.sin(angle + offset) * head}`;
  return `M${a.x2} ${a.y2}L${p(-spread)}L${p(spread)}Z`;
}

function AnnotationMark({ annotation: a }: { annotation: ScreenshotAnnotation }) {
  switch (a.kind) {
    // Painted by AnnotationOverlay itself: highlights first, hides last.
    case "highlight":
    case "hide":
      return null;
    case "rect":
      return (
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          fill="none"
          stroke={a.color}
          strokeWidth={a.strokeWidth}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={a.x + a.w / 2}
          cy={a.y + a.h / 2}
          rx={a.w / 2}
          ry={a.h / 2}
          fill="none"
          stroke={a.color}
          strokeWidth={a.strokeWidth}
        />
      );
    case "arrow": {
      const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
      const head = Math.min(Math.max(a.strokeWidth * 3.4, 12), length);
      return (
        <g>
          <line
            x1={a.x1}
            y1={a.y1}
            x2={a.x2 - Math.cos(angle) * head * 0.85}
            y2={a.y2 - Math.sin(angle) * head * 0.85}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            strokeLinecap="round"
          />
          <path d={arrowHead(a)} fill={a.color} />
        </g>
      );
    }
    case "pen": {
      const pairs: string[] = [];
      for (let i = 0; i + 1 < a.points.length; i += 2) {
        pairs.push(`${a.points[i]},${a.points[i + 1]}`);
      }
      if (pairs.length === 0) return null;
      return (
        <polyline
          points={pairs.join(" ")}
          fill="none"
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    case "text":
      return (
        <text
          x={a.x}
          y={a.y}
          fill={a.color}
          fontSize={a.fontSize}
          dominantBaseline="hanging"
          // The widget bakes its own stack into the PNG; matching it here keeps
          // the overlay on top of the baked glyphs rather than beside them.
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        >
          {a.text.split("\n").map((line, i) => (
            <tspan key={i} x={a.x} dy={i === 0 ? 0 : a.fontSize * 1.25}>
              {line}
            </tspan>
          ))}
        </text>
      );
  }
}

