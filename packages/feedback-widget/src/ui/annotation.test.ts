// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { normaliseRect, paintAnnotations } from './annotation'
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
    rect: record('rect'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const size = { width: 1000, height: 800 }

describe('normaliseRect', () => {
  it('normalises drag direction and rounds to whole image pixels', () => {
    expect(normaliseRect({ x: 30.4, y: 40.6 }, { x: 10.2, y: 20.1 }, 'highlight')).toEqual({
      kind: 'highlight',
      x: 10,
      y: 20,
      w: 20,
      h: 21,
    })
  })

  it('carries the tool kind through', () => {
    expect(normaliseRect({ x: 0, y: 0 }, { x: 5, y: 5 }, 'hide').kind).toBe('hide')
  })
})

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
})

describe('AnnotationCanvas export dimensions', () => {
  it('exports at the captured bitmap size, not a clamped preview width', async () => {
    // A 2x capture: 2400x1600 natural pixels. There must be no MAX_CANVAS_WIDTH clamp.
    const { AnnotationCanvas } = await import('./annotation')
    const src = await import('./annotation')
    expect(Object.keys(src)).not.toContain('MAX_CANVAS_WIDTH')

    const sizes: Array<{ width: number; height: number }> = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'canvas') {
        const canvas = el as HTMLCanvasElement
        canvas.getContext = (() =>
          recordingContext().ctx) as unknown as HTMLCanvasElement['getContext']
        canvas.toBlob = ((cb: BlobCallback) => {
          sizes.push({ width: canvas.width, height: canvas.height })
          cb(new Blob(['x'], { type: 'image/png' }))
        }) as HTMLCanvasElement['toBlob']
      }
      return el
    })

    const shadow = realCreate('div').attachShadow({ mode: 'open' })
    let saved: { width: number; height: number } | null = null
    const editor = new AnnotationCanvas(shadow, { onSave: () => {}, onCancel: () => {} })

    // jsdom cannot decode images; hand the editor a stub of the loaded bitmap.
    Object.defineProperty(editor, 'image', {
      value: { naturalWidth: 2400, naturalHeight: 1600 },
      writable: true,
    })
    const blob = await (
      editor as unknown as { exportImage(): Promise<Blob | null> }
    ).exportImage()
    expect(blob).not.toBeNull()
    saved = sizes[sizes.length - 1]
    expect(saved).toEqual({ width: 2400, height: 1600 })

    vi.restoreAllMocks()
  })
})
