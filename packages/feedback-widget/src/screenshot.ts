import { toPng, toJpeg } from 'html-to-image'

const MAX_SIZE_BYTES = 2 * 1024 * 1024
const CAPTURE_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Screenshot capture timed out')), ms)
    ),
  ])
}

/** True when the node matches any admin-configured mask selector (invalid selectors are ignored). */
export function isMaskedNode(node: Element, maskSelectors: readonly string[]): boolean {
  if (typeof node.matches !== 'function') return false
  for (const selector of maskSelectors) {
    try {
      if (node.matches(selector)) return true
    } catch {
      // invalid selector from config; skip
    }
  }
  return false
}

async function captureHtmlToImage(
  widgetHost: HTMLElement | null,
  maskSelectors: readonly string[]
): Promise<Blob> {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const captureOptions = {
    cacheBust: true,
    width: viewportWidth,
    height: viewportHeight,
    canvasWidth: viewportWidth,
    canvasHeight: viewportHeight,
    style: {
      transform: `translate(-${window.scrollX}px, -${window.scrollY}px)`,
    },
    filter: (node: HTMLElement) => {
      if (widgetHost && node === widgetHost) return false
      if (maskSelectors.length && node instanceof Element && isMaskedNode(node, maskSelectors)) return false
      return true
    },
  }

  const dataUrl = await withTimeout(
    toPng(document.documentElement, captureOptions),
    CAPTURE_TIMEOUT_MS
  )

  const res = await fetch(dataUrl)
  let blob = await res.blob()

  if (blob.size > MAX_SIZE_BYTES) {
    const jpegDataUrl = await toJpeg(document.documentElement, {
      ...captureOptions,
      quality: 0.7,
    })
    const jpegRes = await fetch(jpegDataUrl)
    blob = await jpegRes.blob()
  }

  return blob
}

async function captureNative(): Promise<Blob | null> {
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) return null

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
    } as DisplayMediaStreamOptions)

    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach(t => t.stop())
      return null
    }

    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      track.stop()
      return null
    }
    ctx.drawImage(video, 0, 0)
    track.stop()

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  } catch {
    return null
  }
}

export async function captureScreenshot(
  widgetHost: HTMLElement | null,
  maskSelectors: readonly string[] = []
): Promise<Blob | null> {
  if (widgetHost) widgetHost.style.display = 'none'

  try {
    try {
      return await captureHtmlToImage(widgetHost, maskSelectors)
    } catch {
      const nativeBlob = await captureNative()
      if (nativeBlob) return nativeBlob
      return null
    }
  } finally {
    if (widgetHost) widgetHost.style.display = ''
  }
}
