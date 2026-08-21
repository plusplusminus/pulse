import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationOverlay } from "../annotation-overlay";
import { ANNOTATION_KINDS, type ScreenshotAnnotation } from "@/lib/widget-types";

const natural = { w: 1200, h: 800 };

function render(annotations: ScreenshotAnnotation[]): string {
  return renderToStaticMarkup(
    <AnnotationOverlay annotations={annotations} natural={natural} />
  );
}

const SAMPLES: Record<ScreenshotAnnotation["kind"], ScreenshotAnnotation> = {
  highlight: { kind: "highlight", x: 10, y: 20, w: 100, h: 50 },
  hide: { kind: "hide", x: 5, y: 6, w: 7, h: 8 },
  rect: { kind: "rect", x: 1, y: 2, w: 30, h: 40, color: "#ef4444", strokeWidth: 3 },
  ellipse: { kind: "ellipse", x: 3, y: 4, w: 50, h: 60, color: "#3b82f6", strokeWidth: 5 },
  arrow: { kind: "arrow", x1: 0, y1: 0, x2: 90, y2: 80, color: "#22c55e", strokeWidth: 4 },
  pen: { kind: "pen", points: [0, 0, 5, 5, 10, 2], color: "#f59e0b", strokeWidth: 2 },
  text: { kind: "text", x: 12, y: 34, text: "this is broken", color: "#111827", fontSize: 24 },
};

describe("AnnotationOverlay", () => {
  it("draws in the capture's own pixel space, so it lines up at any width", () => {
    expect(render([SAMPLES.rect])).toContain('viewBox="0 0 1200 800"');
  });

  it("renders something for every kind the widget can produce", () => {
    for (const kind of ANNOTATION_KINDS) {
      const markup = render([SAMPLES[kind]]);
      // The bare <svg> wrapper alone is not rendering the mark.
      expect(markup.length, `${kind} rendered nothing`).toBeGreaterThan(
        render([]).length
      );
    }
  });

  it("dims outside every highlight with one even-odd path, then outlines each", () => {
    const markup = render([
      SAMPLES.highlight,
      { kind: "highlight", x: 300, y: 400, w: 60, h: 60 },
    ]);
    expect(markup).toContain('fill-rule="evenodd"');
    expect(markup).toContain("M0 0H1200V800H0Z");
    expect(markup).toContain("M10 20H110V70H10Z");
    expect(markup).toContain("M300 400H360V460H300Z");
    expect((markup.match(/stroke="#5e6ad2"/g) ?? []).length).toBe(2);
  });

  it("never dims when there is no highlight", () => {
    expect(render([SAMPLES.hide])).not.toContain("evenodd");
  });

  it("paints redactions last so a hide over a highlight still redacts", () => {
    const markup = render([SAMPLES.hide, SAMPLES.highlight]);
    expect(markup.lastIndexOf('fill="#000000"')).toBeGreaterThan(
      markup.indexOf('stroke="#5e6ad2"')
    );
  });

  it("draws a rect as an outline, never a fill that would hide what it marks", () => {
    const markup = render([SAMPLES.rect]);
    expect(markup).toContain('<rect x="1" y="2" width="30" height="40" fill="none"');
    expect(markup).toContain('stroke="#ef4444"');
    expect(markup).toContain('stroke-width="3"');
  });

  it("inscribes an ellipse in its stored rect", () => {
    const markup = render([SAMPLES.ellipse]);
    expect(markup).toContain('cx="28"');
    expect(markup).toContain('cy="34"');
    expect(markup).toContain('rx="25"');
    expect(markup).toContain('ry="30"');
  });

  it("gives an arrow a shaft and a filled head at the second point", () => {
    const markup = render([SAMPLES.arrow]);
    expect(markup).toContain("<line");
    expect(markup).toContain('x1="0"');
    expect(markup).toContain('<path d="M90 80L');
    expect(markup).toContain('fill="#22c55e"');
  });

  it("draws a pen path through every stored point pair", () => {
    expect(render([SAMPLES.pen])).toContain('points="0,0 5,5 10,2"');
  });

  it("renders a label with the widget's own font stack, not the dashboard's", () => {
    const markup = render([SAMPLES.text]);
    expect(markup).toContain("this is broken");
    expect(markup).toContain('font-size="24"');
    expect(markup).toContain("-apple-system");
  });

  it("splits a multi-line label onto separate lines", () => {
    const markup = render([{ ...SAMPLES.text, text: "one\ntwo" } as ScreenshotAnnotation]);
    expect((markup.match(/<tspan/g) ?? []).length).toBe(2);
    expect(markup).toContain('dy="30"');
  });

  it("draws nothing at all for an empty set", () => {
    const markup = render([]);
    expect(markup).not.toContain("<rect");
    expect(markup).not.toContain("<path");
  });

  it("is decorative: it never intercepts a click meant for the image", () => {
    expect(render([SAMPLES.rect])).toContain("pointer-events-none");
  });
});
