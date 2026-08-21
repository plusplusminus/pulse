/**
 * Microphone capture for voice-over (PULSE-400).
 *
 * `getDisplayMedia` cannot hand us a microphone — its `audio` flag captures
 * tab or system audio, which is a different thing entirely and stays off
 * (`recordingConstraints()` keeps `audio: false`). A voice-over is a second,
 * separately consented `getUserMedia` stream whose audio track is composed
 * into the recorded `MediaStream` alongside the display video track.
 *
 * ## Two consent moments, never stacked
 *
 * The mic prompt fires when the reporter ticks "Record with voice-over", not
 * when they click Record. The display picker fires on Record. Keeping them
 * apart means neither prompt is a surprise, and a site with
 * `capture.voiceOver` false never reaches this module at all.
 *
 * ## The mic is not held open between the two
 *
 * Opting in requests the stream purely to settle the permission, then stops
 * the track immediately. A live microphone sitting open while the reporter
 * types a bug title is a worse trade than re-opening it at Record — by which
 * point the permission is granted, so no second prompt appears.
 *
 * DOM-free by design, like `capture/video.ts`: this module only touches the
 * media and Web Audio APIs.
 */

/* Releasing a stream is `stopTracks` from ./video — one release path, not two. */

/** Why a microphone could not be opened. Drives the copy shown to the reporter. */
export type MicFailureReason = 'unsupported' | 'denied' | 'no-device' | 'failed'

export class MicError extends Error {
  constructor(readonly reason: MicFailureReason, message: string) {
    super(message)
    this.name = 'MicError'
  }
}

/**
 * Echo cancellation and noise suppression on: a voice-over is narration over a
 * page the reporter is also playing sound from, and the raw track is close to
 * unlistenable without them.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
}

export function isGetUserMediaSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
}

/**
 * Call synchronously from the opt-in click. Rejects with a `MicError` whose
 * `reason` is what the caller shows; it must never abort a recording.
 */
export function requestMicStream(): Promise<MediaStream> {
  if (!isGetUserMediaSupported()) {
    return Promise.reject(new MicError('unsupported', 'This browser cannot record audio'))
  }
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
}

/**
 * Browsers disagree on the exact name, and Safari has historically thrown a
 * plain `Error`; anything unrecognised is 'failed' rather than a guess at
 * "denied", which would wrongly tell the reporter they refused something.
 */
export function micFailureReason(error: unknown): MicFailureReason {
  if (error instanceof MicError) return error.reason
  const name = (error as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device'
  return 'failed'
}

/**
 * One line, in the panel, straight from whatever `getUserMedia` rejected with.
 * Every variant ends by saying the recording carries on regardless.
 */
export function micNotice(error: unknown): string {
  const reason = micFailureReason(error)
  const cause =
    reason === 'denied'
      ? 'Microphone access was declined'
      : reason === 'no-device'
        ? 'No microphone was found'
        : reason === 'unsupported'
          ? 'This browser cannot record audio'
          : 'The microphone could not be started'
  return `${cause} — the recording continues without it.`
}

// -- level meter --------------------------------------------------------------

/**
 * Raw RMS of speech sits around 0.05–0.2, which would leave a linear meter
 * looking dead on a perfectly good microphone — the exact failure this meter
 * exists to rule out. Scaling up front is what makes normal talking read as
 * roughly half-scale.
 */
export const LEVEL_GAIN = 3.5

/**
 * Fast attack, slow decay. An un-decayed meter driven at frame rate flickers
 * through the zero-crossings of the waveform and reads as a broken mic.
 */
export const LEVEL_DECAY = 0.86

/** Small window: this is a "is anything arriving" indicator, not a spectrum. */
export const LEVEL_FFT_SIZE = 256

/** Pure, so the scaling is testable without a Web Audio implementation. */
export function levelFromWaveform(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / data.length) * LEVEL_GAIN)
}

function defaultAudioContext(): AudioContext | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext
  return Ctor ? new Ctor() : null
}

export interface MicLevelMeterOptions {
  onLevel: (level: number) => void
  /** Injected for tests; returns null where Web Audio is unavailable. */
  createContext?: () => AudioContext | null
  /** Injected for tests; the real one is requestAnimationFrame. */
  schedule?: (callback: () => void) => void
}

/**
 * Drives a 0..1 level off an `AnalyserNode`. Purely observational — it never
 * touches the recorded track, so a meter that fails to start (no Web Audio, a
 * blocked context) costs the recording nothing.
 *
 * Muting is `track.enabled = false`, which already feeds the analyser silence;
 * `setMuted(true)` additionally pins the reported level to the floor so the
 * meter is unambiguous the instant the reporter clicks, rather than a frame or
 * two later. `stop()` just drops `running`, so the next frame is the last one.
 */
export class MicLevelMeter {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  // Constructed over an explicit ArrayBuffer: `getByteTimeDomainData` will not
  // accept a view that might be backed by a SharedArrayBuffer.
  private buffer = new Uint8Array(new ArrayBuffer(0))
  private level = 0
  private muted = false
  private running = false
  private readonly schedule: (callback: () => void) => void

  constructor(private readonly options: MicLevelMeterOptions) {
    this.schedule = options.schedule ?? ((cb) => void requestAnimationFrame(cb))
  }

  /** Never throws: a missing analyser means no meter, not a failed recording. */
  start(stream: MediaStream): void {
    if (this.running) return
    try {
      const context = (this.options.createContext ?? defaultAudioContext)()
      if (!context) return
      const analyser = context.createAnalyser()
      analyser.fftSize = LEVEL_FFT_SIZE
      // Deliberately NOT connected to context.destination: routing the
      // microphone to the speakers is a feedback loop, not a monitor.
      context.createMediaStreamSource(stream).connect(analyser)
      this.context = context
      this.analyser = analyser
      // Time-domain data fills `fftSize` samples, not `frequencyBinCount`.
      this.buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      this.running = true
      this.tick()
    } catch {
      this.stop()
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      this.level = 0
      this.options.onLevel(0)
    }
  }

  stop(): void {
    this.running = false
    this.analyser = null
    void this.context?.close()
    this.context = null
  }

  private tick = (): void => {
    if (!this.running || !this.analyser) return
    if (this.muted) {
      this.options.onLevel(0)
    } else {
      this.analyser.getByteTimeDomainData(this.buffer)
      const next = levelFromWaveform(this.buffer)
      // Rise immediately, fall gently.
      this.level = next > this.level ? next : this.level * LEVEL_DECAY
      this.options.onLevel(this.level)
    }
    this.schedule(this.tick)
  }
}
