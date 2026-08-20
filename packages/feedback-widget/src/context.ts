import type { WidgetContext, ConsoleEntry, SentryContext } from './types'

export function collectContext(
  consoleEntries: ConsoleEntry[],
  sentryContext: SentryContext | null,
  custom: Record<string, string>,
  captureSurface?: WidgetContext['captureSurface']
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
    // Only present when the screenshot came from a native tab capture.
    ...(captureSurface ? { captureSurface } : {}),
  }
}
