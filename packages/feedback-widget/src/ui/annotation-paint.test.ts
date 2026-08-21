// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  annotationBounds,
  hitTest,
  hitsAnnotation,
  paintAnnotations,
  translateAnnotation,
} from './annotation-paint'
import type { ScreenshotAnnotation } from '../types'

type Call = [string, unknown[]]

/** Records the 2D calls paintAnnotations makes, in order. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, args])
    }
  const ctx = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    rect: record('rect'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    stroke: record('stroke'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    translate: record('translate'),
    setLineDash: record('setLineDash'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const size = { width: 1000, height: 800 }

describe('paintAnnotations', () => {
  it('paints nothing for an empty list', () => {
    const { ctx, calls } = recordingContext()
    paintAnnotations(ctx, [], size)
    expect(calls.filter(([n]) => n === 'fill' || n === 'fillRect' || n === 'strokeRect')).toEqual([])
  })

  it('dims outside every highlight with one even-odd fill, then outlines each', () => {
    const highlights: ScreenshotAnnotation[] = [
      { kind: 'highlight', x: 10, y: 20, w: 100, h: 50 },
      { kind: 'highlight', x: 300, y: 400, w: 60, h: 60 },
    ]
    const { ctx, calls } = recordingContext()
    paintAnnotations(ctx, highlights, size)

    const rects = calls.filter(([n]) => n === 'rect').map(([, a]) => a)
    // full canvas first, then one counter-rect per highlight
    expect(rects[0]).toEqual([0, 0, 1000, 800])
    expect(rects.slice(1)).toEqual([
      [10, 20, 100, 50],
      [300, 400, 60, 60],
    ])

    const fills = calls.filter(([n]) => n === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0][1]).toEqual(['evenodd'])

    expect(calls.filter(([n]) => n === 'strokeRect').map(([, a]) => a)).toEqual([
      [10, 20, 100, 50],
      [300, 400, 60, 60],
    ])
    expect(ctx.lineWidth).toBe(3)
  })

  it('fills hide rects solid and never dims when there is no highlight', () => {
    const { ctx, calls } = recordingContext()
    paintAnnotations(ctx, [{ kind: 'hide', x: 5, y: 6, w: 7, h: 8 }], size)
    expect(calls.filter(([n]) => n === 'fill')).toHaveLength(0)
    expect(calls.filter(([n]) => n === 'fillRect').map(([, a]) => a)).toEqual([[5, 6, 7, 8]])
    expect(ctx.fillStyle).toBe('#000000')
  })

  it('paints hides after highlights so a hide over a highlight still redacts', () => {
    const { ctx, calls } = recordingContext()
    paintAnnotations(
      ctx,
      [
        { kind: 'hide', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'highlight', x: 0, y: 0, w: 20, h: 20 },
      ],
      size
    )
    const names = calls.map(([n]) => n)
    expect(names.indexOf('strokeRect')).toBeLessThan(names.indexOf('fillRect'))
  })

  it('dims only the cropped region when export bounds are offset', () => {
    const { ctx, calls } = recordingContext()
    paintAnnotations(ctx, [{ kind: 'highlight', x: 120, y: 140, w: 40, h: 40 }], {
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    })
    expect(calls.filter(([n]) => n === 'rect').map(([, a]) => a)[0]).toEqual([100, 100, 300, 200])
  })
})

describe('annotationBounds', () => {
  it('returns the rect itself for rect kinds', () => {
    expect(annotationBounds({ kind: 'hide', x: 4, y: 5, w: 6, h: 7 })).toEqual({
      x: 4,
      y: 5,
      w: 6,
      h: 7,
    })
  })

  it('encloses an arrow drawn in any direction', () => {
    const b = annotationBounds({
      kind: 'arrow',
      x1: 100,
      y1: 100,
      x2: 20,
      y2: 40,
      color: '#ef4444',
      strokeWidth: 4,
    })
    expect(b.x).toBe(16)
    expect(b.y).toBe(36)
    expect(b.w).toBe(88)
    expect(b.h).toBe(68)
  })

  it('encloses every point of a pen stroke', () => {
    const b = annotationBounds({
      kind: 'pen',
      points: [10, 10, 50, 4, 30, 90],
      color: '#ef4444',
      strokeWidth: 2,
    })
    expect(b).toEqual({ x: 9, y: 3, w: 42, h: 88 })
  })

  it('grows a text box by line count', () => {
    const one = annotationBounds({
      kind: 'text',
      x: 0,
      y: 0,
      text: 'a',
      color: '#ef4444',
      fontSize: 20,
    })
    const two = annotationBounds({
      kind: 'text',
      x: 0,
      y: 0,
      text: 'a\nb',
      color: '#ef4444',
      fontSize: 20,
    })
    expect(two.h).toBeCloseTo(one.h * 2)
  })
})

describe('hit-testing', () => {
  it('hits inside a filled rect and misses outside it', () => {
    const hide: ScreenshotAnnotation = { kind: 'hide', x: 10, y: 10, w: 40, h: 40 }
    expect(hitsAnnotation(hide, { x: 30, y: 30 }, 4)).toBe(true)
    expect(hitsAnnotation(hide, { x: 200, y: 30 }, 4)).toBe(false)
  })

  it('hits an outlined rect on its edge but not through its middle', () => {
    const box: ScreenshotAnnotation = {
      kind: 'rect',
      x: 10,
      y: 10,
      w: 100,
      h: 100,
      color: '#ef4444',
      strokeWidth: 3,
    }
    expect(hitsAnnotation(box, { x: 10, y: 60 }, 4)).toBe(true)
    expect(hitsAnnotation(box, { x: 60, y: 60 }, 4)).toBe(false)
  })

  it('hits near an arrow shaft, not in the empty corner of its bounding box', () => {
    const arrow: ScreenshotAnnotation = {
      kind: 'arrow',
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      color: '#ef4444',
      strokeWidth: 4,
    }
    expect(hitsAnnotation(arrow, { x: 50, y: 52 }, 6)).toBe(true)
    expect(hitsAnnotation(arrow, { x: 95, y: 5 }, 6)).toBe(false)
  })

  it('hits an ellipse on its outline and lets clicks through the middle', () => {
    const ellipse: ScreenshotAnnotation = {
      kind: 'ellipse',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      color: '#ef4444',
      strokeWidth: 4,
    }
    expect(hitsAnnotation(ellipse, { x: 100, y: 0 }, 6)).toBe(true)
    expect(hitsAnnotation(ellipse, { x: 100, y: 100 }, 6)).toBe(false)
  })

  it('picks the topmost mark when marks overlap', () => {
    const marks: ScreenshotAnnotation[] = [
      { kind: 'hide', x: 0, y: 0, w: 100, h: 100 },
      { kind: 'hide', x: 0, y: 0, w: 100, h: 100 },
    ]
    expect(hitTest(marks, { x: 50, y: 50 }, 4)).toBe(1)
  })

  it('returns null when nothing is under the point', () => {
    expect(hitTest([{ kind: 'hide', x: 0, y: 0, w: 10, h: 10 }], { x: 500, y: 500 }, 4)).toBeNull()
  })
})

describe('translateAnnotation', () => {
  it('shifts rect kinds and never mutates the original', () => {
    const original: ScreenshotAnnotation = { kind: 'highlight', x: 10, y: 20, w: 5, h: 5 }
    expect(translateAnnotation(original, 3, -4)).toEqual({
      kind: 'highlight',
      x: 13,
      y: 16,
      w: 5,
      h: 5,
    })
    expect(original.x).toBe(10)
  })

  it('shifts both ends of an arrow', () => {
    expect(
      translateAnnotation(
        { kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, color: '#ef4444', strokeWidth: 2 },
        5,
        5
      )
    ).toEqual({ kind: 'arrow', x1: 5, y1: 5, x2: 15, y2: 15, color: '#ef4444', strokeWidth: 2 })
  })

  it('shifts x and y of a flat pen point list independently', () => {
    expect(
      translateAnnotation(
        { kind: 'pen', points: [0, 0, 10, 20], color: '#ef4444', strokeWidth: 2 },
        1,
        2
      ).points
    ).toEqual([1, 2, 11, 22])
  })
})
