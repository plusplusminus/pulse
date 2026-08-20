// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  frameFromStream,
  isUserCancel,
  requestTabStream,
  stopStream,
  surfaceOf,
  tabCaptureConstraints,
} from './tab-capture'

function fakeTrack(displaySurface?: string) {
  return {
    stop: vi.fn(),
    getSettings: () => ({ displaySurface }),
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
}

function fakeStream(track = fakeTrack('browser')) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
})

describe('tabCaptureConstraints', () => {
  it('requests the viewport at device resolution with Sentry\'s picker constraints', () => {
    expect(tabCaptureConstraints()).toEqual({
      video: { width: 2880, height: 1800 },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    })
  })
})

describe('requestTabStream', () => {
  it('calls getDisplayMedia synchronously so user activation survives', () => {
    const getDisplayMedia = vi.fn(() => Promise.resolve(fakeStream()))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true })

    requestTabStream()
    // Called during the same tick as the click, not after an await.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(getDisplayMedia).toHaveBeenCalledWith(tabCaptureConstraints())
  })
})

describe('isUserCancel', () => {
  it('treats a declined picker as a cancel, not a failure', () => {
    const denied = new Error('denied')
    denied.name = 'NotAllowedError'
    const aborted = new Error('aborted')
    aborted.name = 'AbortError'
    expect(isUserCancel(denied)).toBe(true)
    expect(isUserCancel(aborted)).toBe(true)
    expect(isUserCancel(new Error('boom'))).toBe(false)
    expect(isUserCancel('nope')).toBe(false)
  })
})

describe('surfaceOf', () => {
  it('reads the shared surface and falls back to browser', () => {
    expect(surfaceOf(fakeStream(fakeTrack('window')))).toBe('window')
    expect(surfaceOf(fakeStream(fakeTrack('monitor')))).toBe('monitor')
    expect(surfaceOf(fakeStream(fakeTrack(undefined)))).toBe('browser')
    expect(surfaceOf(fakeStream(fakeTrack('nonsense')))).toBe('browser')
  })
})

describe('stopStream', () => {
  it('stops every track', () => {
    const track = fakeTrack('browser')
    stopStream(fakeStream(track))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})

describe('frameFromStream', () => {
  /** jsdom has no media pipeline; drive the element's lifecycle by hand. */
  function stubMedia(videoWidth: number, videoHeight: number) {
    const drawImage = vi.fn()
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'video') {
        const v = el as HTMLVideoElement
        Object.defineProperty(v, 'videoWidth', { value: videoWidth, configurable: true })
        Object.defineProperty(v, 'videoHeight', { value: videoHeight, configurable: true })
        v.play = vi.fn(() => Promise.resolve())
        // Fire loadedmetadata once the handler is attached.
        queueMicrotask(() => v.onloadedmetadata?.(new Event('loadedmetadata')))
      }
      if (tag === 'canvas') {
        const c = el as HTMLCanvasElement
        c.getContext = (() => ({ drawImage })) as unknown as HTMLCanvasElement['getContext']
        c.toBlob = ((cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/png' }))) as HTMLCanvasElement['toBlob']
      }
      return el
    })
    return { drawImage }
  }

  it('draws one frame at the stream resolution and stops the tracks', async () => {
    stubMedia(2880, 1800)
    const track = fakeTrack('browser')
    const { blob, surface } = await frameFromStream(fakeStream(track))
    expect(blob.type).toBe('image/png')
    expect(surface).toBe('browser')
    expect(track.stop).toHaveBeenCalled()
  })

  it('reports the surface when the user shared a window instead of the tab', async () => {
    stubMedia(1600, 1200)
    const { surface } = await frameFromStream(fakeStream(fakeTrack('window')))
    expect(surface).toBe('window')
  })

  it('throws and still releases the stream when the frame is empty', async () => {
    stubMedia(0, 0)
    const track = fakeTrack('browser')
    await expect(frameFromStream(fakeStream(track))).rejects.toThrow('no frame')
    expect(track.stop).toHaveBeenCalled()
  })

  it('never pulls the lazy capture engine — this path is getDisplayMedia only', async () => {
    document.head.innerHTML = ''
    delete window.__PulseCaptureEngine
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn(async () => fakeStream()) },
      configurable: true,
    })
    stubMedia(2880, 1800)

    await frameFromStream(await requestTabStream())

    expect(document.querySelector('script[data-pulse-capture-engine]')).toBeNull()
    expect(window.__PulseCaptureEngine).toBeUndefined()
  })
})
