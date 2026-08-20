import type { WidgetContext, ConsoleEntry, SentryContext } from './types'

export function collectContext(
  consoleEntries: ConsoleEntry[],
  sentryContext: SentryContext | null,
  custom: Record<string, string>
): WidgetContext {
  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    timestamp: new Date().toISOString(),
    console: consoleEntries,
    sentry: sentryContext,
    custom,
  }
}
