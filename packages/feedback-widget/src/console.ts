import type { ConsoleEntry } from './types'

const MAX_MESSAGE_LENGTH = 500

export class ConsoleInterceptor {
  private buffer: ConsoleEntry[] = []
  private limit: number
  private originals: {
    error: typeof console.error
    warn: typeof console.warn
  } | null = null

  constructor(limit = 50) {
    this.limit = limit
  }

  start(): void {
    if (this.originals) return

    this.originals = {
      error: console.error,
      warn: console.warn,
    }

    const levels = ['error', 'warn'] as const
    for (const level of levels) {
      const original = this.originals[level]
      console[level] = (...args: unknown[]) => {
        const message = args
          .map((arg) => {
            if (arg instanceof Error) return arg.message
            if (typeof arg === 'string') return arg
            try { return JSON.stringify(arg) } catch { return String(arg) }
          })
          .join(' ')
          .slice(0, MAX_MESSAGE_LENGTH)

        this.buffer.push({
          level,
          message,
          timestamp: new Date().toISOString(),
        })

        if (this.buffer.length > this.limit) {
          this.buffer.shift()
        }

        original.apply(console, args)
      }
    }
  }

  stop(): void {
    if (this.originals) {
      console.error = this.originals.error
      console.warn = this.originals.warn
      this.originals = null
    }
  }

  getEntries(): ConsoleEntry[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
  }
}
