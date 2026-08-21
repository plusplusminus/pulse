import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LEVEL_DECAY,
  LEVEL_FFT_SIZE,
  LEVEL_GAIN,
  MIC_CONSTRAINTS,
  MicError,
  MicLevelMeter,
  isGetUserMediaSupported,
  levelFromWaveform,
  micFailureReason,
  micNotice,
  requestMicStream,
} from './mic'

// -- fakes -------------------------------------------------------------------

function fakeTrack(kind: 'audio' | 'video' = 'audio') {
  return { kind, enabled: true, stop: vi.fn() }
}

type FakeTrack = ReturnType<typeof fakeTrack>

function fakeStream(tracks: FakeTrack[] = [fakeTrack()]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream
}

/** Named like a real DOMException so micFailureReason has something to read. */
function mediaError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// -- acquisition --------------------------------------------------------------

describe('requestMicStream', () => {
  it('asks for audio only, with the cleanup a narration track needs', () => {
    expect(MIC_CONSTRAINTS).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      // Never video: getUserMedia is here for a voice-over, not a webcam.
      video: false,
    })
  })

  it('calls getUserMedia with exactly those constraints', async () => {
    const stream = fakeStream()
    const getUserMedia = vi.fn(async () => stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    await expect(requestMicStream()).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS)
  })

  it('rejects with an unsupported MicError rather than throwing where there is no API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })

    expect(isGetUserMediaSupported()).toBe(false)
    const error = await requestMicStream().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MicError)
    expect((error as MicError).reason).toBe('unsupported')
  })
})

describe('micFailureReason', () => {
  it('reads a declined prompt off the DOMException name', () => {
    expect(micFailureReason(mediaError('NotAllowedError'))).toBe('denied')
    expect(micFailureReason(mediaError('SecurityError'))).toBe('denied')
  })

  it('separates "no microphone" from "you said no"', () => {
    expect(micFailureReason(mediaError('NotFoundError'))).toBe('no-device')
    expect(micFailureReason(mediaError('OverconstrainedError'))).toBe('no-device')
  })

  it('reads a rejection where getUserMedia is absent entirely', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
    expect(micFailureReason(await requestMicStream().catch((e) => e))).toBe('unsupported')
  })

  it('never guesses "denied" for an unrecognised failure', () => {
    // Telling a reporter they declined something they never saw is worse than
    // saying the microphone would not start.
    expect(micFailureReason(mediaError('AbortError'))).toBe('failed')
    expect(micFailureReason(mediaError('NotReadableError'))).toBe('failed')
    expect(micFailureReason(new Error('boom'))).toBe('failed')
    expect(micFailureReason(null)).toBe('failed')
    expect(micFailureReason(undefined)).toBe('failed')
  })

  it('passes a MicError through by its own reason', () => {
    expect(micFailureReason(new MicError('unsupported', 'x'))).toBe('unsupported')
  })
})

describe('micNotice', () => {
  it('always ends by saying the recording carries on', () => {
    const failures = [
      mediaError('NotAllowedError'),
      mediaError('NotFoundError'),
      new MicError('unsupported', 'x'),
      mediaError('AbortError'),
    ]
    for (const failure of failures) {
      expect(micNotice(failure)).toContain('the recording continues without it')
    }
  })

  it('names the actual cause, so the reporter knows whether to retry', () => {
    expect(micNotice(mediaError('NotAllowedError'))).toContain('declined')
    expect(micNotice(mediaError('NotFoundError'))).toContain('No microphone')
    expect(micNotice(new MicError('unsupported', 'x'))).toContain('cannot record audio')
    expect(micNotice(mediaError('AbortError'))).toContain('could not be started')
  })
})

// -- level maths --------------------------------------------------------------

/** 128 is the zero line of 8-bit time-domain data. */
function waveform(amplitude: number, length = 64): Uint8Array {
  const data = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) {
    data[i] = 128 + Math.round(amplitude * 128) * (i % 2 === 0 ? 1 : -1)
  }
  return data
}

describe('levelFromWaveform', () => {
  it('reads silence as the floor', () => {
    expect(levelFromWaveform(waveform(0))).toBe(0)
  })

  it('reads an empty buffer as the floor rather than NaN', () => {
    expect(levelFromWaveform(new Uint8Array(new ArrayBuffer(0)))).toBe(0)
  })

  it('lifts speech-level RMS clear of the floor — a linear meter would look dead', () => {
    // ~0.1 RMS is normal talking; unscaled that is a 10% bar on a working mic.
    const level = levelFromWaveform(waveform(0.1))
    expect(level).toBeCloseTo(0.1 * LEVEL_GAIN, 1)
    expect(level).toBeGreaterThan(0.3)
  })

  it('clamps a loud input to 1 instead of overflowing the bar', () => {
    expect(levelFromWaveform(waveform(1))).toBe(1)
  })

  it('rises monotonically with input', () => {
    const quiet = levelFromWaveform(waveform(0.02))
    const loud = levelFromWaveform(waveform(0.2))
    expect(loud).toBeGreaterThan(quiet)
  })
})

// -- the meter ----------------------------------------------------------------

/**
 * Enough of Web Audio to drive the analyser loop. `amplitude` is what the fake
 * microphone is "hearing" right now.
 */
function fakeAudio(amplitude = { value: 0 }) {
  const analyser = {
    fftSize: 0,
    get frequencyBinCount() {
      return analyser.fftSize / 2
    },
    getByteTimeDomainData: vi.fn((data: Uint8Array) => {
      data.set(waveform(amplitude.value, data.length))
    }),
    disconnect: vi.fn(),
  }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const context = {
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
    close: vi.fn(async () => {}),
  }
  return { analyser, source, context: context as unknown as AudioContext, amplitude }
}

/** Runs the meter's rAF loop by hand, one frame at a time. */
function manualFrames() {
  let next: (() => void) | null = null
  return {
    schedule: (cb: () => void) => {
      next = cb
    },
    step(times = 1) {
      for (let i = 0; i < times; i++) {
        const cb = next
        next = null
        cb?.()
      }
    },
    get pending() {
      return next !== null
    },
  }
}

describe('MicLevelMeter', () => {
  let levels: number[]
  let frames: ReturnType<typeof manualFrames>

  beforeEach(() => {
    levels = []
    frames = manualFrames()
  })

  function meter(audio: ReturnType<typeof fakeAudio>): MicLevelMeter {
    return new MicLevelMeter({
      onLevel: (l) => levels.push(l),
      createContext: () => audio.context,
      schedule: frames.schedule,
    })
  }

  it('moves with input: a live signal drives the level off the floor', () => {
    const audio = fakeAudio({ value: 0.15 })
    meter(audio).start(fakeStream())

    frames.step(2)

    expect(levels.length).toBeGreaterThan(0)
    expect(levels[levels.length - 1]).toBeGreaterThan(0.2)
  })

  it('sits at the floor for silence', () => {
    const audio = fakeAudio({ value: 0 })
    meter(audio).start(fakeStream())

    frames.step(3)

    expect(levels.every((l) => l === 0)).toBe(true)
  })

  it('pins the level to the floor the instant it is muted, not a frame later', () => {
    const audio = fakeAudio({ value: 0.4 })
    const m = meter(audio)
    m.start(fakeStream())
    frames.step(2)
    expect(levels[levels.length - 1]).toBeGreaterThan(0)

    m.setMuted(true)

    expect(levels[levels.length - 1]).toBe(0)
    // ...and stays there while the loop keeps running over a live signal.
    frames.step(3)
    expect(levels.every((l) => l === 0)).toBe(false) // earlier frames were loud
    expect(levels.slice(-3)).toEqual([0, 0, 0])
  })

  it('comes back off the floor when unmuted mid-recording', () => {
    const audio = fakeAudio({ value: 0.4 })
    const m = meter(audio)
    m.start(fakeStream())
    m.setMuted(true)
    frames.step(2)
    expect(levels[levels.length - 1]).toBe(0)

    m.setMuted(false)
    frames.step(2)

    expect(levels[levels.length - 1]).toBeGreaterThan(0)
  })

  it('falls gently rather than strobing through the waveform zero-crossings', () => {
    const audio = fakeAudio({ value: 0.3 })
    const m = meter(audio)
    m.start(fakeStream())
    frames.step(2)
    const peak = levels[levels.length - 1]

    audio.amplitude.value = 0
    frames.step(1)

    expect(levels[levels.length - 1]).toBeCloseTo(peak * LEVEL_DECAY, 5)
  })

  it('uses a small analyser window and a matching time-domain buffer', () => {
    const audio = fakeAudio()
    meter(audio).start(fakeStream())
    frames.step(1)

    expect(audio.analyser.fftSize).toBe(LEVEL_FFT_SIZE)
    const [buffer] = audio.analyser.getByteTimeDomainData.mock.calls[0]
    expect(buffer.length).toBe(LEVEL_FFT_SIZE)
  })

  it('never routes the microphone to the speakers', () => {
    const audio = fakeAudio()
    meter(audio).start(fakeStream())
    // Only the analyser is connected; a destination connection is a howl.
    expect(audio.source.connect).toHaveBeenCalledTimes(1)
    expect(audio.source.connect).toHaveBeenCalledWith(audio.analyser)
  })

  it('tears down the graph and stops the loop on stop', () => {
    const audio = fakeAudio()
    const m = meter(audio)
    m.start(fakeStream())
    frames.step(1)

    m.stop()

    expect(audio.context.close).toHaveBeenCalled()
    const before = levels.length
    frames.step(2)
    expect(levels).toHaveLength(before)
  })

  it('is a no-op where Web Audio is unavailable — no meter is not a failed recording', () => {
    const m = new MicLevelMeter({
      onLevel: (l) => levels.push(l),
      createContext: () => null,
      schedule: frames.schedule,
    })

    expect(() => m.start(fakeStream())).not.toThrow()
    expect(frames.pending).toBe(false)
    expect(levels).toEqual([])
    expect(() => m.stop()).not.toThrow()
  })

  it('swallows a context that throws on construction', () => {
    const m = new MicLevelMeter({
      onLevel: (l) => levels.push(l),
      createContext: () => {
        throw new Error('AudioContext blocked')
      },
      schedule: frames.schedule,
    })

    expect(() => m.start(fakeStream())).not.toThrow()
    expect(levels).toEqual([])
  })

  it('never touches the track it is observing', () => {
    const track = fakeTrack()
    const audio = fakeAudio({ value: 0.3 })
    const m = meter(audio)
    m.start(fakeStream([track]))
    frames.step(3)
    m.setMuted(true)
    m.stop()

    // Muting is the widget's job (track.enabled); the meter only reads.
    expect(track.stop).not.toHaveBeenCalled()
    expect(track.enabled).toBe(true)
  })
})
