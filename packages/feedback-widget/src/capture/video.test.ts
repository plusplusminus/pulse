import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AUDIO_BITS_PER_SECOND,
  AUDIO_MIME_CANDIDATES,
  MAX_RECORDING_MS,
  MIME_CANDIDATES,
  TIMESLICE_MS,
  VIDEO_BITS_PER_SECOND,
  createVideoRecorder,
  extensionFor,
  negotiateMimeType,
  recordingConstraints,
  requestRecordingStream,
  type VideoPostProcess,
} from './video'

// -- fakes -------------------------------------------------------------------

type Listener = () => void

function fakeTrack() {
  const listeners: Listener[] = []
  return {
    kind: 'video',
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, fn: Listener) => {
      if (event === 'ended') listeners.push(fn)
    }),
    /** Stands in for the browser's own "Stop sharing" bar. */
    end: () => listeners.forEach((fn) => fn()),
  }
}

type FakeTrack = ReturnType<typeof fakeTrack>

function fakeStream(tracks: FakeTrack[] = [fakeTrack()]) {
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream & { tracks: FakeTrack[] }
}

let supported: string[] = []
let instances: FakeMediaRecorder[] = []

class FakeMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => supported.includes(type))

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  timeslice: number | undefined
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(
    readonly stream: MediaStream,
    readonly options: { mimeType: string; videoBitsPerSecond?: number; audioBitsPerSecond?: number }
  ) {
    instances.push(this)
  }

  get mimeType(): string {
    return this.options.mimeType
  }

  start(timeslice?: number): void {
    this.state = 'recording'
    this.timeslice = timeslice
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }

  /** One timeslice's worth of bytes. */
  emit(size: number): void {
    this.ondataavailable?.({ data: new Blob(['x'.repeat(size)]) })
  }
}

const WEBM_VP9 = 'video/webm;codecs=vp9'

/** Drives the recorder off a clock the test controls. */
function clock(start = 1_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

beforeEach(() => {
  supported = [...MIME_CANDIDATES]
  instances = []
  FakeMediaRecorder.isTypeSupported.mockClear()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// -- constraints & negotiation -----------------------------------------------

describe('recordingConstraints', () => {
  it('caps resolution and frame rate, allows tab switching, forbids whole screens', () => {
    expect(recordingConstraints()).toEqual({
      video: {
        frameRate: { ideal: 15, max: 30 },
        width: { max: 1920 },
        height: { max: 1080 },
      },
      audio: false,
      preferCurrentTab: true,
      // A recording may legitimately follow the user to another tab.
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'exclude',
    })
  })
})

describe('requestRecordingStream', () => {
  it('calls getDisplayMedia synchronously so user activation survives', () => {
    const stream = fakeStream()
    const getDisplayMedia = vi.fn(() => Promise.resolve(stream))
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })

    requestRecordingStream()

    // Called in the same tick as the click, not after an await.
    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(getDisplayMedia).toHaveBeenCalledWith(recordingConstraints())
  })
})

describe('negotiateMimeType', () => {
  it('prefers vp9, then vp8, then plain webm', () => {
    expect(negotiateMimeType(() => true)).toBe(WEBM_VP9)
    expect(negotiateMimeType((t) => t !== WEBM_VP9)).toBe('video/webm;codecs=vp8')
    expect(negotiateMimeType((t) => t === 'video/webm')).toBe('video/webm')
  })

  it('falls back to MP4 on desktop Safari, which writes nothing else', () => {
    expect(negotiateMimeType((t) => t === 'video/mp4;codecs=avc1')).toBe(
      'video/mp4;codecs=avc1'
    )
    expect(negotiateMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
  })

  it('probes in the documented order and stops at the first hit', () => {
    const seen: string[] = []
    negotiateMimeType((t) => {
      seen.push(t)
      return t === 'video/webm'
    })
    expect(seen).toEqual([WEBM_VP9, 'video/webm;codecs=vp8', 'video/webm'])
  })

  it('is null where nothing can be recorded', () => {
    expect(negotiateMimeType(() => false)).toBeNull()
  })

  it('reads MediaRecorder.isTypeSupported by default', () => {
    supported = ['video/webm']
    expect(negotiateMimeType()).toBe('video/webm')
    expect(FakeMediaRecorder.isTypeSupported).toHaveBeenCalledWith(WEBM_VP9)
  })
})

// -- voice-over codec negotiation (PULSE-400) --------------------------------

const WEBM_VP9_OPUS = 'video/webm;codecs=vp9,opus'
const WEBM_VP8_OPUS = 'video/webm;codecs=vp8,opus'
const MP4_AVC1_AAC = 'video/mp4;codecs=avc1,mp4a.40.2'

describe('negotiateMimeType with a voice-over track', () => {
  it('prefers the Opus-paired WebM types over every video-only candidate', () => {
    expect(negotiateMimeType(() => true, true)).toBe(WEBM_VP9_OPUS)
    expect(negotiateMimeType((t) => t !== WEBM_VP9_OPUS, true)).toBe(WEBM_VP8_OPUS)
  })

  it('pairs MP4 with AAC for desktop Safari, which records nothing else', () => {
    expect(negotiateMimeType((t) => t === MP4_AVC1_AAC, true)).toBe(MP4_AVC1_AAC)
  })

  it('probes every audio pairing before falling back to the video-only list', () => {
    const seen: string[] = []
    negotiateMimeType((t) => {
      seen.push(t)
      return t === WEBM_VP9
    }, true)
    expect(seen).toEqual([WEBM_VP9_OPUS, WEBM_VP8_OPUS, MP4_AVC1_AAC, WEBM_VP9])
  })

  it('still records video where no pairing is supported, rather than refusing', () => {
    // Losing the narration is bad; losing the repro because of it is worse.
    expect(negotiateMimeType((t) => t === 'video/webm', true)).toBe('video/webm')
  })

  it('is null only when nothing at all can be recorded', () => {
    expect(negotiateMimeType(() => false, true)).toBeNull()
  })

  it('leaves the silent path untouched — no audio track, no Opus probe', () => {
    const seen: string[] = []
    negotiateMimeType((t) => {
      seen.push(t)
      return false
    })
    expect(seen).toEqual([...MIME_CANDIDATES])
    expect(seen.some((t) => t.includes('opus'))).toBe(false)
  })

  it('every audio candidate normalises to a container the upload allowlist knows', () => {
    // src/lib/widget-upload.ts keys WIDGET_MEDIA_CONTENT_TYPES on the base type
    // ("video/webm" / "video/mp4"), so a candidate outside those two would be
    // negotiated happily by the widget and then 400'd on upload.
    for (const candidate of AUDIO_MIME_CANDIDATES) {
      expect(candidate.split(';')[0]).toMatch(/^video\/(webm|mp4)$/)
    }
  })

  it('gives every audio candidate the extension its container implies', () => {
    expect(extensionFor(WEBM_VP9_OPUS)).toBe('webm')
    expect(extensionFor(WEBM_VP8_OPUS)).toBe('webm')
    expect(extensionFor(MP4_AVC1_AAC)).toBe('mp4')
  })
})

describe('extensionFor', () => {
  it('derives the extension from the container, never relabelling', () => {
    expect(extensionFor(WEBM_VP9)).toBe('webm')
    expect(extensionFor('video/webm')).toBe('webm')
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionFor('video/mp4')).toBe('mp4')
    // Chrome occasionally reports matroska; it is a WebM variant, not MP4.
    expect(extensionFor('video/x-matroska;codecs=avc1')).toBe('webm')
  })
})

// -- lifecycle ---------------------------------------------------------------

describe('createVideoRecorder', () => {
  it('records, reports progress, and resolves the finished recording', async () => {
    vi.useFakeTimers()
    const time = clock()
    const progress: Array<{ elapsedMs: number; bytes: number }> = []
    const stream = fakeStream()

    const recorder = createVideoRecorder({
      now: time.now,
      progressIntervalMs: 250,
      onProgress: (p) => progress.push(p),
    })
    await recorder.start(stream)

    const media = instances[0]
    expect(media.options.mimeType).toBe(WEBM_VP9)
    expect(media.options.videoBitsPerSecond).toBe(VIDEO_BITS_PER_SECOND)
    expect(media.timeslice).toBe(TIMESLICE_MS)
    expect(recorder.isRecording).toBe(true)

    media.emit(1_000)
    time.advance(2_000)
    vi.advanceTimersByTime(250)
    expect(progress.at(-1)).toEqual({ elapsedMs: 2_000, bytes: 1_000 })

    media.emit(500)
    time.advance(1_000)
    const recording = await recorder.stop()

    expect(recording.mimeType).toBe(WEBM_VP9)
    expect(recording.extension).toBe('webm')
    expect(recording.durationMs).toBe(3_000)
    expect(recording.blob.size).toBe(1_500)
    expect(recording.blob.type).toBe(WEBM_VP9)
    expect(recorder.isRecording).toBe(false)
  })

  it('keeps the mimeType MediaRecorder actually negotiated', async () => {
    supported = ['video/mp4']
    const recorder = createVideoRecorder()
    await recorder.start(fakeStream())
    instances[0].emit(10)
    const recording = await recorder.stop()

    expect(recording.mimeType).toBe('video/mp4')
    expect(recording.extension).toBe('mp4')
  })

  it('stops itself at the 2-minute cap', async () => {
    vi.useFakeTimers()
    const time = clock()
    const onEnd = vi.fn()
    const stream = fakeStream()

    const recorder = createVideoRecorder({
      now: time.now,
      progressIntervalMs: 250,
      onEnd,
    })
    await recorder.start(stream)
    instances[0].emit(10)

    time.advance(MAX_RECORDING_MS - 1)
    vi.advanceTimersByTime(250)
    expect(onEnd).not.toHaveBeenCalled()
    expect(instances[0].state).toBe('recording')

    time.advance(1)
    vi.advanceTimersByTime(250)

    expect(onEnd).toHaveBeenCalledWith('limit')
    expect(instances[0].state).toBe('inactive')
    expect(stream.tracks[0].stop).toHaveBeenCalled()

    // The blob is still collectable after an automatic stop.
    const recording = await recorder.stop()
    expect(recording.durationMs).toBe(MAX_RECORDING_MS)
  })

  it('honours a custom cap', async () => {
    vi.useFakeTimers()
    const time = clock()
    const recorder = createVideoRecorder({
      now: time.now,
      progressIntervalMs: 100,
      maxDurationMs: 5_000,
    })
    await recorder.start(fakeStream())
    instances[0].emit(10)

    time.advance(5_000)
    vi.advanceTimersByTime(100)

    expect(instances[0].state).toBe('inactive')
    expect((await recorder.stop()).durationMs).toBe(5_000)
  })

  it('stops when the browser’s own "Stop sharing" ends the track', async () => {
    const time = clock()
    const onEnd = vi.fn()
    const stream = fakeStream()
    const recorder = createVideoRecorder({ now: time.now, onEnd })
    await recorder.start(stream)
    instances[0].emit(42)

    time.advance(4_000)
    stream.tracks[0].end()

    expect(onEnd).toHaveBeenCalledWith('source-ended')
    expect(instances[0].state).toBe('inactive')

    const recording = await recorder.stop()
    expect(recording.durationMs).toBe(4_000)
    expect(recording.blob.size).toBe(42)
  })

  it('ends only once, whichever trigger fires first', async () => {
    const onEnd = vi.fn()
    const stream = fakeStream()
    const recorder = createVideoRecorder({ onEnd })
    await recorder.start(stream)

    stream.tracks[0].end()
    stream.tracks[0].end()
    await recorder.stop()

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith('source-ended')
  })

  it('releases every track on stop so the sharing indicator goes away', async () => {
    const tracks = [fakeTrack(), fakeTrack()]
    const stream = fakeStream(tracks)
    const recorder = createVideoRecorder()
    await recorder.start(stream)
    await recorder.stop()

    for (const track of tracks) expect(track.stop).toHaveBeenCalled()
  })

  it('cancel releases every track and rejects the pending stop', async () => {
    const tracks = [fakeTrack(), fakeTrack()]
    const stream = fakeStream(tracks)
    const recorder = createVideoRecorder()
    await recorder.start(stream)

    recorder.cancel()

    // Nothing to collect: a cancelled recording is discarded, not returned.
    await expect(recorder.stop()).rejects.toThrow('cancelled')
    for (const track of tracks) expect(track.stop).toHaveBeenCalled()
    expect(recorder.isRecording).toBe(false)
  })

  it('cancel before the user picks a surface still releases the stream', async () => {
    const stream = fakeStream()
    const recorder = createVideoRecorder()

    let release!: (s: MediaStream) => void
    const pending = new Promise<MediaStream>((resolve) => (release = resolve))
    const started = recorder.start(pending)

    recorder.cancel()
    release(stream)

    await expect(started).rejects.toThrow('cancelled')
    expect(stream.tracks[0].stop).toHaveBeenCalled()
    expect(instances).toHaveLength(0)
  })

  it('refuses to start twice', async () => {
    const recorder = createVideoRecorder()
    await recorder.start(fakeStream())
    await expect(recorder.start(fakeStream())).rejects.toThrow('already started')
  })

  it('rejects stop() before start()', async () => {
    await expect(createVideoRecorder().stop()).rejects.toThrow('has not started')
  })

  it('releases the stream when no codec can be recorded', async () => {
    supported = []
    const stream = fakeStream()
    await expect(createVideoRecorder().start(stream)).rejects.toThrow('cannot record video')
    expect(stream.tracks[0].stop).toHaveBeenCalled()
  })

  it('rejects and releases the stream on a recorder error', async () => {
    const stream = fakeStream()
    const recorder = createVideoRecorder()
    await recorder.start(stream)

    instances[0].onerror?.()

    await expect(recorder.stop()).rejects.toThrow('Recording failed')
    expect(stream.tracks[0].stop).toHaveBeenCalled()
  })
})

// -- WebM duration post-processing -------------------------------------------

describe('duration post-processing', () => {
  it('runs the fixer over WebM, which Chrome writes with no duration header', async () => {
    const fixed = new Blob(['fixed'])
    const postProcess = vi.fn<VideoPostProcess>(async () => fixed)
    const time = clock()

    const recorder = createVideoRecorder({ postProcess, now: time.now })
    await recorder.start(fakeStream())
    instances[0].emit(10)
    time.advance(7_000)
    const recording = await recorder.stop()

    expect(postProcess).toHaveBeenCalledTimes(1)
    expect(postProcess.mock.calls[0][1]).toEqual({
      mimeType: WEBM_VP9,
      durationMs: 7_000,
    })
    expect(recording.blob).toBe(fixed)
  })

  it('skips the fixer for MP4, which already carries its duration', async () => {
    supported = ['video/mp4;codecs=avc1']
    const postProcess = vi.fn<VideoPostProcess>(async (b) => b)

    const recorder = createVideoRecorder({ postProcess })
    await recorder.start(fakeStream())
    instances[0].emit(10)
    await recorder.stop()

    expect(postProcess).not.toHaveBeenCalled()
  })

  it('ships the unfixed recording when the fixer fails', async () => {
    const postProcess = vi.fn<VideoPostProcess>(async () => {
      throw new Error('engine unreachable')
    })

    const recorder = createVideoRecorder({ postProcess })
    await recorder.start(fakeStream())
    instances[0].emit(64)
    const recording = await recorder.stop()

    expect(recording.blob.size).toBe(64)
    expect(recording.mimeType).toBe(WEBM_VP9)
  })
})

// -- recording a composed voice-over stream (PULSE-400) ----------------------

function audioTrack() {
  return { ...fakeTrack(), kind: 'audio' as const }
}

/** Display video + microphone audio, the shape MediaRecorder is handed. */
function composedStream(video: FakeTrack, audio: FakeTrack) {
  const tracks = [video, audio]
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => [video],
    getAudioTracks: () => [audio],
  } as unknown as MediaStream & { tracks: FakeTrack[] }
}

describe('recording with a voice-over track', () => {
  beforeEach(() => {
    supported = [...AUDIO_MIME_CANDIDATES, ...MIME_CANDIDATES]
  })

  it('negotiates an Opus-paired type off the stream it was handed, not a flag', async () => {
    const recorder = createVideoRecorder()
    await recorder.start(composedStream(fakeTrack(), audioTrack()))

    expect(instances[0].options.mimeType).toBe('video/webm;codecs=vp9,opus')
    recorder.cancel()
  })

  it('stays video-only when the microphone never opened', async () => {
    // The composed stream degraded to display-only: the negotiated type has to
    // follow the truth, or the recorder claims an audio track it does not have.
    const recorder = createVideoRecorder()
    await recorder.start(fakeStream())

    expect(instances[0].options.mimeType).toBe(WEBM_VP9)
    recorder.cancel()
  })

  it('spends 64 kbps on speech rather than the browser default', async () => {
    const recorder = createVideoRecorder()
    await recorder.start(composedStream(fakeTrack(), audioTrack()))

    expect(instances[0].options.audioBitsPerSecond).toBe(AUDIO_BITS_PER_SECOND)
    recorder.cancel()
  })

  it('never ends the recording because the microphone died', async () => {
    const video = fakeTrack()
    const audio = audioTrack()
    const onEnd = vi.fn()
    const recorder = createVideoRecorder({ onEnd })
    await recorder.start(composedStream(video, audio))

    // A mic unplugged mid-repro must cost the narration, never the video.
    expect(audio.addEventListener).not.toHaveBeenCalled()
    expect(video.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function), {
      once: true,
    })

    audio.end()
    expect(onEnd).not.toHaveBeenCalled()
    expect(recorder.isRecording).toBe(true)

    video.end()
    expect(onEnd).toHaveBeenCalledWith('source-ended')
  })

  it('releases the microphone when the recording finishes, not before', async () => {
    const video = fakeTrack()
    const audio = audioTrack()
    const recorder = createVideoRecorder()
    await recorder.start(composedStream(video, audio))
    instances[0].emit(32)

    // Mid-recording: muting is the caller's job and it is never a stop().
    expect(audio.stop).not.toHaveBeenCalled()

    await recorder.stop()

    // No lingering microphone indicator in the tab once the recording ends.
    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(video.stop).toHaveBeenCalledTimes(1)
  })

  it('releases the microphone on discard too', async () => {
    const video = fakeTrack()
    const audio = audioTrack()
    const recorder = createVideoRecorder()
    await recorder.start(composedStream(video, audio))

    recorder.cancel()

    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(video.stop).toHaveBeenCalledTimes(1)
  })

  it('releases the microphone when the recorder errors', async () => {
    const video = fakeTrack()
    const audio = audioTrack()
    const recorder = createVideoRecorder()
    await recorder.start(composedStream(video, audio))

    // The error path, not the stop path: nothing has asked it to end.
    instances[0].onerror?.()
    await expect(recorder.stop()).rejects.toThrow(/Recording failed/)

    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(video.stop).toHaveBeenCalledTimes(1)
  })
})
