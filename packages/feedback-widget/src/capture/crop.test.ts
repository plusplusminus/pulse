// @vitest-environment jsdom
/**
 * jsdom has no 2D context, so the canvas is stubbed — but the stub records the
 * two things the acceptance criteria are actually about: the pixel dimensions
 * of the output, and which source pixels were copied into it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cropToRegion, CROP_FAILED } from './crop'

interface DrawCall {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

let drawn: DrawCall[]
let canvases: { width: number; height: number }[]
let blobType: string | undefined
let realCreateElement: typeof document.createElement

function stubCanvas(produceBlob: Blob | null = new Blob(['crop'], { type: 'image/png' })): void {
  realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreateElement(tag)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_src: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
          drawn.push({ sx, sy, sw, sh, dx, dy, dw, dh })
        },
      }),
      toBlob: (cb: (b: Blob | null) => void, type?: string) => {
        blobType = type
        cb(produceBlob)
      },
    }
    canvases.push(canvas as unknown as { width: number; height: number })
    return canvas as unknown as HTMLElement
  }) as typeof document.createElement)
}

function stubBitmap(width: number, height: number): void {
  const close = vi.fn()
  ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({ width, height, close }))
}

beforeEach(() => {
  drawn = []
  canvases = []
  blobType = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
})

describe('cropToRegion', () => {
  it('outputs the selected region at device resolution — 400x300 at 2x is 800x600', async () => {
    stubBitmap(2000, 1600)
    stubCanvas()

    await cropToRegion(new Blob(['png'], { type: 'image/png' }), { x: 100, y: 50, width: 400, height: 300 }, { width: 1000, height: 800 })

    expect(canvases[0].width).toBe(800)
    expect(canvases[0].height).toBe(600)
  })

  it('copies the region from its position in the bitmap, not from the origin', async () => {
    stubBitmap(2000, 1600)
    stubCanvas()

    await cropToRegion(new Blob(['png'], { type: 'image/png' }), { x: 100, y: 50, width: 400, height: 300 }, { width: 1000, height: 800 })

    expect(drawn).toEqual([{ sx: 200, sy: 100, sw: 800, sh: 600, dx: 0, dy: 0, dw: 800, dh: 600 }])
  })

  it('never scales: the destination rect always matches the source rect', async () => {
    stubBitmap(1000, 800)
    stubCanvas()

    await cropToRegion(new Blob(['png'], { type: 'image/png' }), { x: 10, y: 20, width: 300, height: 200 }, { width: 1000, height: 800 })

    const call = drawn[0]
    expect(call.dw).toBe(call.sw)
    expect(call.dh).toBe(call.sh)
  })

  it('keeps a JPEG a JPEG — a crop never re-encodes a size fallback back up to PNG', async () => {
    stubBitmap(2000, 1600)
    stubCanvas()

    await cropToRegion(new Blob(['jpg'], { type: 'image/jpeg' }), { x: 0, y: 0, width: 100, height: 100 }, { width: 1000, height: 800 })

    expect(blobType).toBe('image/jpeg')
  })

  it('releases the decoded bitmap even when the draw fails', async () => {
    const close = vi.fn()
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({ width: 100, height: 100, close }))
    stubCanvas(null)

    await expect(
      cropToRegion(new Blob(['png'], { type: 'image/png' }), { x: 0, y: 0, width: 50, height: 50 }, { width: 100, height: 100 })
    ).rejects.toThrow(CROP_FAILED)
    expect(close).toHaveBeenCalled()
  })
})
