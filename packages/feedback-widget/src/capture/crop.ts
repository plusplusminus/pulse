import { regionPixelRect, regionScale, type PixelRect, type Size } from './region'
import type { DragRect } from './pick-mode'

/**
 * Cropping a captured bitmap down to a selected region (PULSE-404).
 *
 * The crop happens AFTER a full-viewport capture and in the bitmap's own pixel
 * space, so the region comes out at device resolution. Capturing a scaled-down
 * viewport and enlarging it would be the same number of pixels and none of the
 * detail, which is the entire reason to pick a region in the first place.
 */

export const CROP_FAILED = 'Could not crop the selected region.'

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(CROP_FAILED))
      el.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/** PNG unless the engine already fell back to JPEG for size; a crop never upgrades. */
function outputType(source: Blob): string {
  return source.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
}

async function draw(image: Decoded, rect: PixelRect, type: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(CROP_FAILED)

  ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), type)
  })
  if (!out) throw new Error(CROP_FAILED)
  return out
}

/**
 * `region` is in viewport CSS pixels — exactly what the selector drew. The
 * scale is derived from the bitmap itself, so this is correct whatever DPR the
 * engine captured at.
 */
export async function cropToRegion(blob: Blob, region: DragRect, viewport: Size): Promise<Blob> {
  const image = await decode(blob)
  try {
    const rect = regionPixelRect(region, regionScale(image, viewport), image)
    return await draw(image, rect, outputType(blob))
  } finally {
    image.release()
  }
}
