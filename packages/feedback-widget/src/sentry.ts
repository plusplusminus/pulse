import type { SentryContext } from './types'

interface SentryHub {
  getClient?: () => SentryClient | undefined
  getScope?: () => SentryScope | undefined
}

interface SentryClient {
  getIntegrationByName?: (name: string) => SentryReplay | undefined
  getIntegration?: (name: string) => SentryReplay | undefined
  getDsn?: () => SentryDsn | undefined
}

interface SentryScope {
  getSession?: () => { sid?: string } | undefined
  getPropagationContext?: () => { traceId?: string } | undefined
}

interface SentryReplay {
  getReplayId?: () => string | undefined
}

interface SentryDsn {
  host?: string
}

interface SentryV8 {
  getReplay?: () => SentryReplay | undefined
  getClient?: () => SentryClient | undefined
  getActiveSpan?: () => { spanContext?: () => { traceId?: string } } | undefined
}

function buildReplayUrl(replayId: string | null, dsn: SentryDsn | undefined): string | null {
  if (!replayId || !dsn?.host) return null
  const orgSlug = dsn.host.split('.')[0]
  if (!orgSlug) return null
  return `https://sentry.io/organizations/${orgSlug}/replays/${replayId}/`
}

function detectSentryV7(): SentryContext | null {
  try {
    const sentryGlobal = (window as unknown as Record<string, unknown>).__SENTRY__ as { hub?: SentryHub } | undefined
    if (!sentryGlobal?.hub) return null

    const hub = sentryGlobal.hub
    const client = hub.getClient?.()
    const scope = hub.getScope?.()

    const replay = client?.getIntegrationByName?.('Replay')
      ?? client?.getIntegration?.('Replay')

    const replayId = replay?.getReplayId?.() ?? null
    const dsn = client?.getDsn?.()

    return {
      replayId,
      replayUrl: buildReplayUrl(replayId, dsn),
      sessionId: scope?.getSession?.()?.sid ?? null,
      traceId: scope?.getPropagationContext?.()?.traceId ?? null,
    }
  } catch {
    return null
  }
}

function detectSentryV8(): SentryContext | null {
  try {
    const sentry = (window as unknown as Record<string, unknown>).Sentry as SentryV8 | undefined
    if (!sentry) return null

    const replayId = sentry.getReplay?.()?.getReplayId?.() ?? null
    const client = sentry.getClient?.()
    const dsn = client?.getDsn?.()

    return {
      replayId,
      replayUrl: buildReplayUrl(replayId, dsn),
      sessionId: null,
      traceId: sentry.getActiveSpan?.()?.spanContext?.()?.traceId ?? null,
    }
  } catch {
    return null
  }
}

export function detectSentry(): SentryContext | null {
  return detectSentryV8() ?? detectSentryV7()
}
