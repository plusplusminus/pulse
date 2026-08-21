/**
 * Painting and geometry for screenshot annotations (PULSE-401).
 *
 * Pure apart from the 2D context it is handed: no DOM, no editor state. The
 * same functions draw the live preview and the exported PNG, so what the
 * reporter sees is what ships.
 *
 * Every coordinate is in the captured bitmap's own pixel space. Stroke and font
 * sizes arrive already multiplied by the capture's DPR, so nothing here needs
 * to know the reporter's display density.
 */
import type { AnnotationRect, ScreenshotAnnotation } from '../types'

/** Fixed appearance for the two original tools; unchanged from PULSE-333. */
const HIGHLIGHT_STROKE = '#5e6ad2'
const HIGHLIGHT_WIDTH = 3
const DIM_FILL = 'rgba(0, 0, 0, 0.45)'
const HIDE_FILL = '#000000'

/**
 * The widget owns its type stack outright. A host page's `body { font-family }`
 * cannot reach a canvas — `ctx.font` is always set explicitly — and the in-shadow
 * text input sets the same stack, so the two stay WYSIWYG on any site.
 */
export const ANNOTATION_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const LINE_HEIGHT = 1.25

export interface Point {
  x: number
  y: number
}

/** The region being painted. `x`/`y` are non-zero only when exporting a crop. */
export interface PaintBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export function annotationFont(fontSize: number): string {
  return `${fontSize}px ${ANNOTATION_FONT_STACK}`
}

/** Splitting on \n keeps a pasted multi-line label intact. */
export function textLines(text: string): string[] {
  return text.split('\n')
}

/**
 * Dark colours get a light halo and light colours a dark one, so a label stays
 * readable whatever it lands on. Without it, white text on a white screenshot
 * is simply invisible and the reporter cannot tell until the export.
 */
export function haloColor(color: string): string {
  const hex = color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)'
}

function strokeStyle(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** Head length scales with the stroke so a thick arrow does not grow a pin-head. */
export function arrowHeadLength(strokeWidth: number): number {
  return Math.max(strokeWidth * 3.4, 12)
}

function paintArrow(
  ctx: CanvasRenderingContext2D,
  a: Extract<ScreenshotAnnotation, { kind: 'arrow' }>
): void {
  const dx = a.x2 - a.x1
  const dy = a.y2 - a.y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return

  const angle = Math.atan2(dy, dx)
  const head = Math.min(arrowHeadLength(a.strokeWidth), length)
  // Stop the shaft short of the tip so the triangle is not drawn over a blunt end.
  const shaftEndX = a.x2 - Math.cos(angle) * head * 0.85
  const shaftEndY = a.y2 - Math.sin(angle) * head * 0.85

  ctx.save()
  strokeStyle(ctx, a.color, a.strokeWidth)
  ctx.beginPath()
  ctx.moveTo(a.x1, a.y1)
  ctx.lineTo(shaftEndX, shaftEndY)
  ctx.stroke()

  const spread = 0.42
  ctx.beginPath()
  ctx.moveTo(a.x2, a.y2)
  ctx.lineTo(a.x2 - Math.cos(angle - spread) * head, a.y2 - Math.sin(angle - spread) * head)
  ctx.lineTo(a.x2 - Math.cos(angle + spread) * head, a.y2 - Math.sin(angle + spread) * head)
  ctx.closePath()
  ctx.fillStyle = a.color
  ctx.fill()
  ctx.restore()
}

function paintEllipse(
  ctx: CanvasRenderingContext2D,
  a: Extract<ScreenshotAnnotation, { kind: 'ellipse' }>
): void {
  ctx.save()
  strokeStyle(ctx, a.color, a.strokeWidth)
  ctx.beginPath()
  ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/**
 * Midpoint smoothing: each sample becomes a quadratic control point and the
 * curve passes through the midpoints between them. A raw polyline through
 * pointermove samples looks visibly faceted; this costs nothing and does not.
 */
function paintPen(
  ctx: CanvasRenderingContext2D,
  a: Extract<ScreenshotAnnotation, { kind: 'pen' }>
): void {
  const p = a.points
  if (p.length < 4) {
    // A tap, not a stroke: render a dot so the mark is not silently lost.
    if (p.length === 2) {
      ctx.save()
      ctx.fillStyle = a.color
      ctx.beginPath()
      ctx.arc(p[0], p[1], a.strokeWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    return
  }

  ctx.save()
  strokeStyle(ctx, a.color, a.strokeWidth)
  ctx.beginPath()
  ctx.moveTo(p[0], p[1])
  for (let i = 2; i < p.length - 2; i += 2) {
    const midX = (p[i] + p[i + 2]) / 2
    const midY = (p[i + 1] + p[i + 3]) / 2
    ctx.quadraticCurveTo(p[i], p[i + 1], midX, midY)
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1])
  ctx.stroke()
  ctx.restore()
}

function paintText(
  ctx: CanvasRenderingContext2D,
  a: Extract<ScreenshotAnnotation, { kind: 'text' }>
): void {
  ctx.save()
  ctx.font = annotationFont(a.fontSize)
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = haloColor(a.color)
  ctx.lineWidth = Math.max(a.fontSize / 10, 1)
  ctx.fillStyle = a.color
  const lines = textLines(a.text)
  for (let i = 0; i < lines.length; i++) {
    const y = a.y + i * a.fontSize * LINE_HEIGHT
    ctx.strokeText(lines[i], a.x, y)
    ctx.fillText(lines[i], a.x, y)
  }
  ctx.restore()
}

/**
 * Paints the annotation layer at the bitmap's native resolution.
 *
 * Order is deliberate: highlights dim the rest of the frame first (one even-odd
 * fill for the whole set), then the drawn marks, then hides last — a redaction
 * must never end up underneath something.
 */
export function paintAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly ScreenshotAnnotation[],
  bounds: PaintBounds
): void {
  const ox = bounds.x ?? 0
  const oy = bounds.y ?? 0
  const highlights = annotations.filter((a) => a.kind === 'highlight')

  if (highlights.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, bounds.width, bounds.height)
    for (const r of highlights) ctx.rect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = DIM_FILL
    ctx.fill('evenodd')
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = HIGHLIGHT_STROKE
    ctx.lineWidth = HIGHLIGHT_WIDTH
    for (const r of highlights) {
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    ctx.restore()
  }

  for (const a of annotations) {
    switch (a.kind) {
      case 'rect':
        ctx.save()
        strokeStyle(ctx, a.color, a.strokeWidth)
        ctx.strokeRect(a.x, a.y, a.w, a.h)
        ctx.restore()
        break
      case 'ellipse':
        paintEllipse(ctx, a)
        break
      case 'arrow':
        paintArrow(ctx, a)
        break
      case 'pen':
        paintPen(ctx, a)
        break
      case 'text':
        paintText(ctx, a)
        break
      default:
        // highlight is painted above; hide is painted below.
        break
    }
  }

  ctx.save()
  ctx.fillStyle = HIDE_FILL
  for (const r of annotations) {
    if (r.kind === 'hide') ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  ctx.restore()
}

// -- Geometry: bounds, hit-testing and moving ------------------------------

/** Width of the widest line, measured when a context is available. */
function measureText(
  a: Extract<ScreenshotAnnotation, { kind: 'text' }>,
  ctx?: CanvasRenderingContext2D
): number {
  const lines = textLines(a.text)
  if (ctx && typeof ctx.measureText === 'function') {
    ctx.save()
    ctx.font = annotationFont(a.fontSize)
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
    ctx.restore()
    return width
  }
  // Estimate for environments with no text metrics (jsdom).
  return Math.max(...lines.map((l) => l.length)) * a.fontSize * 0.55
}

/** Axis-aligned box enclosing the mark, in image pixels. */
export function annotationBounds(
  a: ScreenshotAnnotation,
  ctx?: CanvasRenderingContext2D
): AnnotationRect {
  switch (a.kind) {
    case 'arrow': {
      const pad = a.strokeWidth
      return {
        x: Math.min(a.x1, a.x2) - pad,
        y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2,
        h: Math.abs(a.y2 - a.y1) + pad * 2,
      }
    }
    case 'pen': {
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < a.points.length; i += 2) {
        xs.push(a.points[i])
        ys.push(a.points[i + 1])
      }
      if (xs.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
      const pad = a.strokeWidth / 2
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      return {
        x: minX - pad,
        y: minY - pad,
        w: Math.max(...xs) - minX + pad * 2,
        h: Math.max(...ys) - minY + pad * 2,
      }
    }
    case 'text': {
      const lines = textLines(a.text)
      return {
        x: a.x,
        y: a.y,
        w: measureText(a, ctx),
        h: lines.length * a.fontSize * LINE_HEIGHT,
      }
    }
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h }
  }
}

function distanceToSegment(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - ax, p.y - ay)
  const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSq))
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
}

function withinRect(p: Point, r: AnnotationRect, pad: number): boolean {
  return (
    p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
  )
}

/**
 * Whether the point selects this mark. Filled marks (highlight, hide, text) hit
 * anywhere inside; thin marks (arrow, pen, rect, ellipse outlines) hit near the
 * ink, with a tolerance so a 2 px line is still grabbable with a finger.
 */
export function hitsAnnotation(
  a: ScreenshotAnnotation,
  p: Point,
  tolerance: number,
  ctx?: CanvasRenderingContext2D
): boolean {
  switch (a.kind) {
    case 'highlight':
    case 'hide':
    case 'text':
      return withinRect(p, annotationBounds(a, ctx), tolerance)
    case 'rect': {
      const pad = Math.max(tolerance, a.strokeWidth)
      const outer = withinRect(p, a, pad)
      const inner =
        p.x > a.x + pad && p.x < a.x + a.w - pad && p.y > a.y + pad && p.y < a.y + a.h - pad
      return outer && !inner
    }
    case 'ellipse': {
      const rx = a.w / 2
      const ry = a.h / 2
      if (rx <= 0 || ry <= 0) return false
      const nx = (p.x - (a.x + rx)) / rx
      const ny = (p.y - (a.y + ry)) / ry
      const d = nx * nx + ny * ny
      // A band around the outline rather than the whole disc, so an ellipse
      // drawn around something does not swallow clicks meant for what is inside.
      const band = Math.max(tolerance, a.strokeWidth) / Math.min(rx, ry)
      return d <= (1 + band) * (1 + band) && d >= (1 - band) * (1 - band)
    }
    case 'arrow':
      return (
        distanceToSegment(p, a.x1, a.y1, a.x2, a.y2) <=
        Math.max(tolerance, a.strokeWidth)
      )
    case 'pen': {
      const limit = Math.max(tolerance, a.strokeWidth)
      for (let i = 0; i + 3 < a.points.length; i += 2) {
        if (
          distanceToSegment(p, a.points[i], a.points[i + 1], a.points[i + 2], a.points[i + 3]) <=
          limit
        ) {
          return true
        }
      }
      return a.points.length === 2 && Math.hypot(p.x - a.points[0], p.y - a.points[1]) <= limit
    }
  }
}

/** Index of the topmost mark under the point — last drawn wins — or null. */
export function hitTest(
  annotations: readonly ScreenshotAnnotation[],
  p: Point,
  tolerance: number,
  ctx?: CanvasRenderingContext2D
): number | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitsAnnotation(annotations[i], p, tolerance, ctx)) return i
  }
  return null
}

/** A copy of the mark shifted by (dx, dy). Never mutates the input. */
export function translateAnnotation<T extends ScreenshotAnnotation>(
  a: T,
  dx: number,
  dy: number
): T {
  switch (a.kind) {
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }
    case 'pen':
      return { ...a, points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }
    default:
      return { ...a, x: a.x + dx, y: a.y + dy }
  }
}
