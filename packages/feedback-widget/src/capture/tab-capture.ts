/**
 * Native tab capture via the Screen Capture API — the path for canvas/WebGL,
 * cross-origin iframes and video, none of which a DOM serialiser can render.
 */

/** What the user actually shared, from track.getSettings().displaySurface. */
export type CaptureSurface = 'browser' | 'window' | 'monitor'

const SURFACES: CaptureSurface[] = ['browser', 'window', 'monitor']

/** False on iOS Safari and anywhere else the API is absent; the button hides. */
export function isTabCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

/**
 * Sentry's feedback-widget constraint set: pre-select this tab, permit sharing
 * it at all, and hide both the "switch tab" and whole-screen options so the
 * picker offers essentially one honest choice.
 */
export function tabCaptureConstraints(
  viewport: { width: number; height: number; dpr: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }
): DisplayMediaStreamOptions {
  return {
    video: { width: viewport.width * viewport.dpr, height: viewport.height * viewport.dpr },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions
}

/**
 * MUST be called synchronously from the click handler — no await may precede
 * it, or the transient user activation is gone and the prompt never appears.
 */
export function requestTabStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia(tabCaptureConstraints())
}

export function isUserCancel(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

export function surfaceOf(stream: MediaStream): CaptureSurface {
  const setting = stream.getVideoTracks()[0]?.getSettings?.().displaySurface
  return SURFACES.includes(setting as CaptureSurface) ? (setting as CaptureSurface) : 'browser'
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * One frame at the stream's native resolution. The tracks are stopped as soon
 * as the pixels are on the canvas, so the browser's "sharing" indicator lives
 * for as short a time as possible.
 */
export async function frameFromStream(
  stream: MediaStream
): Promise<{ blob: Blob; surface: CaptureSurface }> {
  const surface = surfaceOf(stream)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Tab capture stream failed to load'))
    })
    await video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Tab capture produced no frame')
    }
    ctx.drawImage(video, 0, 0)

    // Pixels are captured: release the stream before encoding.
    stopStream(stream)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    if (!blob) throw new Error('Tab capture could not be encoded')
    return { blob, surface }
  } finally {
    stopStream(stream)
    video.srcObject = null
  }
}
