import { describe, it, expect } from 'vitest'
import {
  MIN_REGION_SIZE,
  clampRegion,
  formatRegionSize,
  isRegionTooSmall,
  regionPixelRect,
  regionScale,
} from './region'

describe('isRegionTooSmall', () => {
  it('rejects a click with no drag at all', () => {
    expect(isRegionTooSmall({ x: 10, y: 10, width: 0, height: 0 })).toBe(true)
  })

  it('rejects a sliver on either axis', () => {
    expect(isRegionTooSmall({ x: 0, y: 0, width: 200, height: 4 })).toBe(true)
    expect(isRegionTooSmall({ x: 0, y: 0, width: 4, height: 200 })).toBe(true)
  })

  it('accepts a deliberate box', () => {
    expect(isRegionTooSmall({ x: 0, y: 0, width: MIN_REGION_SIZE, height: MIN_REGION_SIZE })).toBe(false)
  })
})

describe('clampRegion', () => {
  const viewport = { width: 1000, height: 800 }

  it('leaves an on-screen rect alone', () => {
    const rect = { x: 100, y: 100, width: 400, height: 300 }
    expect(clampRegion(rect, viewport)).toEqual(rect)
  })

  it('trims a drag that ran off the right and bottom edges', () => {
    expect(clampRegion({ x: 800, y: 700, width: 500, height: 400 }, viewport)).toEqual({
      x: 800,
      y: 700,
      width: 200,
      height: 100,
    })
  })

  it('trims a drag that started off the top-left', () => {
    expect(clampRegion({ x: -50, y: -20, width: 200, height: 100 }, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 80,
    })
  })

  it('collapses a rect entirely outside the viewport rather than inverting it', () => {
    const out = clampRegion({ x: 1200, y: 900, width: 100, height: 100 }, viewport)
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })
})

describe('formatRegionSize', () => {
  it('reads as CSS pixels, rounded', () => {
    expect(formatRegionSize({ x: 0, y: 0, width: 400.4, height: 299.6 })).toBe('400 × 300')
  })
})

describe('regionScale', () => {
  it('derives the device ratio from the bitmap, not devicePixelRatio', () => {
    expect(regionScale({ width: 2000, height: 1600 }, { width: 1000, height: 800 })).toEqual({ x: 2, y: 2 })
  })

  it('falls back to 1 rather than dividing by a zero viewport', () => {
    expect(regionScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ x: 1, y: 1 })
  })
})

describe('regionPixelRect', () => {
  const image = { width: 2000, height: 1600 }

  it('yields the selection at DEVICE resolution — 400x300 at 2x is 800x600', () => {
    const rect = regionPixelRect({ x: 100, y: 50, width: 400, height: 300 }, { x: 2, y: 2 }, image)
    expect(rect).toEqual({ x: 200, y: 100, width: 800, height: 600 })
  })

  it('is 1:1 on a non-retina display', () => {
    const rect = regionPixelRect({ x: 10, y: 20, width: 400, height: 300 }, { x: 1, y: 1 }, { width: 1000, height: 800 })
    expect(rect).toEqual({ x: 10, y: 20, width: 400, height: 300 })
  })

  /**
   * Scaling the width independently of the origin is how a 400px selection
   * becomes 799px: 100.5*2 rounds to 201, and 400*2 added to it overruns.
   */
  it('keeps the exact size across a half-pixel origin', () => {
    const rect = regionPixelRect({ x: 100.5, y: 50.5, width: 400, height: 300 }, { x: 2, y: 2 }, image)
    expect(rect.width).toBe(800)
    expect(rect.height).toBe(600)
  })

  it('never names pixels outside the bitmap', () => {
    const rect = regionPixelRect({ x: 900, y: 700, width: 400, height: 300 }, { x: 2, y: 2 }, image)
    expect(rect.x + rect.width).toBeLessThanOrEqual(image.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(image.height)
  })

  it('never produces a zero-dimension canvas', () => {
    const rect = regionPixelRect({ x: 0, y: 0, width: 0, height: 0 }, { x: 2, y: 2 }, image)
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })
})
