/**
 * Short-form screen recording: `getDisplayMedia` + `MediaRecorder` (PULSE-336).
 *
 * Deliberately DOM-free and UI-free — only the browser media APIs. Everything
 * that needs a document (hiding the widget, the preview, the lazily fetched
 * WebM duration fixer) is injected or lives in the caller.
 *
 * ## Codec negotiation
 *
 * Probed in this order, first hit wins:
 *
 *   1. `video/webm;codecs=vp9`   — best quality per byte where it exists
 *   2. `video/webm;codecs=vp8`   — older Chromium/Firefox
 *   3. `video/webm`              — let the browser pick a WebM codec
 *   4. `video/mp4;codecs=avc1`   — desktop Safari only ever writes MP4/H.264
 *   5. `video/mp4`
 *
 * WebM first because it is what the overwhelming majority of desktop browsers
 * record natively; MP4 exists purely so desktop Safari is not left without a
 * recorder. (iOS has no `getDisplayMedia` at all — PULSE-339 hides the button
 * there rather than negotiating a codec that can never be used.)
 *
 * Whatever `MediaRecorder` reports as its `mimeType` is what we keep, and the
 * file extension is derived from it. We never relabel a container: an `.webm`
 * name on MP4 bytes breaks playback everywhere downstream.
 */

/** File extension, always derived from the recorder's real mimeType. */
export type VideoExtension = 'webm' | 'mp4'

export interface VideoRecording {
  blob: Blob
  /** Exactly what MediaRecorder reported — never a relabel. */
  mimeType: string
  extension: VideoExtension
  durationMs: number
}

/** Why recording ended. `user` is the stop button; the others are not our doing. */
export type VideoEndReason = 'user' | 'limit' | 'source-ended'

export interface VideoProgress {
  elapsedMs: number
  bytes: number
}

/**
 * Applied to WebM output before it is handed back. Injected rather than
 * imported so this module keeps no DOM dependency and the ~4 KB gz duration
 * fixer stays out of the embed bundle until a recording actually finishes.
 */
export type VideoPostProcess = (
  blob: Blob,
  info: { mimeType: string; durationMs: number }
) => Promise<Blob>

export interface VideoRecorderOptions {
  /** Hard cap; the recorder stops itself on reaching it. */
  maxDurationMs?: number
  videoBitsPerSecond?: number
  onProgress?: (progress: VideoProgress) => void
  /**
   * Fired exactly once when recording ends, by any route. `stop()` still
   * resolves the recording afterwards, so a UI can react here and collect the
   * blob at its leisure.
   */
  onEnd?: (reason: VideoEndReason) => void
  /** WebM only; MP4 already carries its duration. */
  postProcess?: VideoPostProcess
  /** Injected for tests. */
  now?: () => number
  timesliceMs?: number
  progressIntervalMs?: number
  isTypeSupported?: (mimeType: string) => boolean
}

export interface VideoRecorder {
  /**
   * Accepts the *pending* stream so the caller can fire `getDisplayMedia`
   * synchronously from the click handler and hand us the promise.
   */
  start(source: MediaStream | Promise<MediaStream>): Promise<void>
  /** Resolves the finished recording; safe to call after an automatic stop. */
  stop(): Promise<VideoRecording>
  /** Tears everything down; the pending `stop()` rejects. */
  cancel(): void
  readonly isRecording: boolean
}

/** 2 minutes. Long enough for a repro, short enough to upload on hotel wifi. */
export const MAX_RECORDING_MS = 120_000

export const VIDEO_BITS_PER_SECOND = 2_500_000

/** Chunk cadence. Small enough that a crash loses little, large enough to be cheap. */
export const TIMESLICE_MS = 2_000

const PROGRESS_INTERVAL_MS = 250

export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const

export class VideoRecorderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoRecorderError'
  }
}

/**
 * `surfaceSwitching: 'include'` on purpose — unlike a one-frame tab capture, a
 * recording may legitimately follow the user to another tab mid-repro.
 * Monitor sharing stays excluded: whole-screen recordings leak far more than
 * the reporter intends.
 */
export function recordingConstraints(): DisplayMediaStreamOptions {
  return {
    video: {
      frameRate: { ideal: 15, max: 30 },
      width: { max: 1920 },
      height: { max: 1080 },
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions
}

/**
 * MUST be called synchronously from the click handler — no await may precede
 * it, or the transient user activation is gone and the prompt never appears.
 */
export function requestRecordingStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia(recordingConstraints())
}

function defaultIsTypeSupported(mimeType: string): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(mimeType)
  )
}

/** First supported candidate, or null where nothing in the list can be recorded. */
export function negotiateMimeType(
  isTypeSupported: (mimeType: string) => boolean = defaultIsTypeSupported
): string | null {
  for (const candidate of MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate
  }
  return null
}

/**
 * Anything that is not explicitly MP4 is written as `.webm`: the candidate list
 * only ever offers those two containers, so a surprise value is far more likely
 * to be a WebM variant (Chrome sometimes reports `video/x-matroska`) than MP4.
 */
export function extensionFor(mimeType: string): VideoExtension {
  return /^video\/mp4\b/i.test(mimeType) ? 'mp4' : 'webm'
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

class DisplayRecorder implements VideoRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private bytes = 0
  private mimeType = ''
  private startedAt = 0
  private endedAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private result: Promise<VideoRecording> | null = null
  private settle: ((recording: VideoRecording) => void) | null = null
  private fail: ((error: unknown) => void) | null = null
  private ended = false
  private cancelled = false

  private readonly maxDurationMs: number
  private readonly now: () => number

  constructor(private readonly options: VideoRecorderOptions = {}) {
    this.maxDurationMs = options.maxDurationMs ?? MAX_RECORDING_MS
    this.now = options.now ?? (() => Date.now())
  }

  get isRecording(): boolean {
    return this.recorder !== null && !this.ended
  }

  async start(source: MediaStream | Promise<MediaStream>): Promise<void> {
    if (this.recorder) throw new VideoRecorderError('Recording already started')

    const stream = await source

    // Cancelled while the user was still choosing a surface: release it and stop.
    if (this.cancelled) {
      stopTracks(stream)
      throw new VideoRecorderError('Recording cancelled')
    }

    const mimeType = negotiateMimeType(this.options.isTypeSupported)
    if (!mimeType) {
      stopTracks(stream)
      throw new VideoRecorderError('This browser cannot record video')
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: this.options.videoBitsPerSecond ?? VIDEO_BITS_PER_SECOND,
    })

    this.stream = stream
    this.recorder = recorder
    // Prefer what the recorder actually negotiated; some browsers leave it blank.
    this.mimeType = recorder.mimeType || mimeType

    this.result = new Promise<VideoRecording>((resolve, reject) => {
      this.settle = resolve
      this.fail = reject
    })
    // A cancelled recording nobody awaited must not surface as an unhandled
    // rejection; this does not consume the rejection for real callers.
    this.result.catch(() => {})

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data)
        this.bytes += event.data.size
      }
    }
    recorder.onstop = () => {
      void this.finish()
    }
    recorder.onerror = () => {
      this.abort(new VideoRecorderError('Recording failed'))
    }

    // The browser's own "Stop sharing" bar ends the track, not the recorder.
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => this.endBecause('source-ended'), { once: true })
    }

    this.startedAt = this.now()
    recorder.start(this.options.timesliceMs ?? TIMESLICE_MS)
    this.timer = setInterval(
      () => this.tick(),
      this.options.progressIntervalMs ?? PROGRESS_INTERVAL_MS
    )
  }

  stop(): Promise<VideoRecording> {
    if (!this.result) {
      return Promise.reject(new VideoRecorderError('Recording has not started'))
    }
    // No-op when the cap or the browser already ended it; same result either way.
    this.endBecause('user')
    return this.result
  }

  cancel(): void {
    this.cancelled = true
    this.ended = true
    this.clearTimer()
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
    stopTracks(this.stream)
    this.stream = null
    this.chunks = []
    this.fail?.(new VideoRecorderError('Recording cancelled'))
  }

  private tick(): void {
    const elapsedMs = this.now() - this.startedAt
    this.options.onProgress?.({ elapsedMs, bytes: this.bytes })
    if (elapsedMs >= this.maxDurationMs) this.endBecause('limit')
  }

  private endBecause(reason: VideoEndReason): void {
    if (this.ended || !this.recorder) return
    this.ended = true
    this.endedAt = this.now()
    this.clearTimer()
    this.options.onEnd?.(reason)
    if (this.recorder.state !== 'inactive') {
      this.recorder.stop()
    } else {
      void this.finish()
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Always releases the stream, so the browser's sharing indicator goes away. */
  private async finish(): Promise<void> {
    this.clearTimer()
    stopTracks(this.stream)
    this.stream = null
    if (this.cancelled) return

    const durationMs = Math.max(0, (this.endedAt || this.now()) - this.startedAt)
    const extension = extensionFor(this.mimeType)
    let blob = new Blob(this.chunks, { type: this.mimeType })

    // Chrome writes WebM with no Duration in the Segment Info, so the file will
    // not seek in a <video> element or in Linear. MP4 already carries its own.
    // A failed fix is not worth failing the recording over — ship it unfixed.
    if (extension === 'webm' && this.options.postProcess) {
      try {
        blob = await this.options.postProcess(blob, { mimeType: this.mimeType, durationMs })
      } catch {
        // keep the original blob
      }
    }

    this.settle?.({ blob, mimeType: this.mimeType, extension, durationMs })
  }

  private abort(error: unknown): void {
    this.ended = true
    this.clearTimer()
    stopTracks(this.stream)
    this.stream = null
    this.fail?.(error)
  }
}

export function createVideoRecorder(options: VideoRecorderOptions = {}): VideoRecorder {
  return new DisplayRecorder(options)
}
