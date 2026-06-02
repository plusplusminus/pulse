import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Preview,
} from '@react-email/components'
import { EmailHeader } from './components/email-header'
import { EmailFooter } from './components/email-footer'
import { EventRow } from './components/event-row'

export interface DigestEvent {
  type: string
  summary: string
  timestamp: string
  deepLinkUrl: string
  actorName?: string
  metadata?: Record<string, string>
}

export interface DigestNotificationProps {
  hubName: string
  hubSlug: string
  events: Record<string, DigestEvent[]>
  period: 'daily' | 'weekly'
  dateRange: string
  /** IANA timezone of the recipient, used to render event times in their local time. */
  timeZone?: string
}

// Display order for event types in digest emails (must match the event_type
// values stored on notification_events).
const EVENT_TYPE_ORDER = [
  'new_issue',
  'status_change',
  'comment',
  'project_update',
  'cycle_update',
  'initiative_update',
]

export function DigestNotification({
  hubName,
  hubSlug,
  events,
  period,
  dateRange,
  timeZone,
}: DigestNotificationProps) {
  const totalCount = Object.values(events).reduce((sum, items) => sum + items.length, 0)
  const summaryParts = Object.entries(events).map(
    ([type, items]) => `${items.length} ${formatEventType(type).toLowerCase()}`
  )
  const summaryText = summaryParts.join(', ')
  const previewText = `${period === 'daily' ? 'Daily' : 'Weekly'} digest: ${summaryText} — ${hubName}`

  // Sort event types by defined order, then any remaining types alphabetically
  const sortedTypes = Object.keys(events).sort((a, b) => {
    const ai = EVENT_TYPE_ORDER.indexOf(a)
    const bi = EVENT_TYPE_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader hubName={hubName} subtitle={`${period === 'daily' ? 'Daily' : 'Weekly'} Digest · ${dateRange}`} />

          <Section style={content}>
            <Section style={statsBar}>
              <Text style={statsText}>
                {totalCount} update{totalCount !== 1 ? 's' : ''}: {summaryText}
              </Text>
            </Section>

            {sortedTypes.map((type) => (
              <Section key={type} style={sectionCard}>
                <Text style={sectionHeader}>
                  {formatEventType(type)} ({events[type].length})
                </Text>
                {events[type].map((event, i) => (
                  <EventRow
                    key={i}
                    summary={event.summary}
                    timestamp={event.timestamp}
                    deepLinkUrl={event.deepLinkUrl}
                    actorName={event.actorName}
                    metadata={event.metadata}
                    timeZone={timeZone}
                  />
                ))}
              </Section>
            ))}
          </Section>

          <EmailFooter hubSlug={hubSlug} />
        </Container>
      </Body>
    </Html>
  )
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const body = {
  backgroundColor: '#f4f4f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '40px 0',
} as const

const container = {
  backgroundColor: '#ffffff',
  borderRadius: '8px',
  maxWidth: '560px',
  margin: '0 auto',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
} as const

const content = {
  padding: '24px 32px',
} as const

const statsBar = {
  backgroundColor: '#fafafa',
  borderRadius: '6px',
  padding: '12px 16px',
  marginBottom: '20px',
} as const

const statsText = {
  color: '#444444',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
} as const

const sectionCard = {
  backgroundColor: '#fafafa',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '12px',
} as const

const sectionHeader = {
  color: '#1a1a1a',
  fontSize: '13px',
  fontWeight: 600 as const,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.3px',
  margin: '0 0 8px',
  paddingBottom: '8px',
  borderBottom: '1px solid #e5e5e5',
} as const

export default DigestNotification
