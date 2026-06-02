import { Section, Text, Link } from '@react-email/components'
import { formatMetadataEntries } from './format-metadata'

// Fallback when no recipient timezone is supplied. Kept local to the email
// layer so this component doesn't depend on the server-only preferences module.
const FALLBACK_TIMEZONE = 'Africa/Johannesburg'

interface EventRowProps {
  summary: string
  timestamp: string
  deepLinkUrl: string
  actorName?: string
  metadata?: Record<string, unknown>
  /** IANA timezone of the recipient, used to render event times in their local time. */
  timeZone?: string
}

export function EventRow({ summary, timestamp, deepLinkUrl, actorName, metadata, timeZone }: EventRowProps) {
  const entries = formatMetadataEntries(metadata)
  const projectEntry = entries.find((e) => e.key.toLowerCase() === 'project')
  const detailEntries = entries.filter((e) => e.key.toLowerCase() !== 'project')

  // Context line: Project first, then clean metadata labels, then actor · date.
  const parts: string[] = []
  if (projectEntry) parts.push(projectEntry.value)
  for (const entry of detailEntries) parts.push(`${entry.label}: ${entry.value}`)
  if (actorName) parts.push(actorName)
  parts.push(formatTimestamp(timestamp, timeZone))

  return (
    <Section style={{ padding: '10px 0', borderBottom: '1px solid #ebebeb' }}>
      <Text style={{ color: '#1a1a1a', fontSize: '14px', lineHeight: '20px', margin: '0 0 2px', fontWeight: 500 }}>
        {summary}
      </Text>
      <Text style={{ color: '#888888', fontSize: '12px', lineHeight: '16px', margin: '0' }}>
        {parts.join(' · ')}
      </Text>
      <Link href={deepLinkUrl} style={{ color: '#5E6AD2', fontSize: '12px', fontWeight: 500, textDecoration: 'none', marginTop: '6px', display: 'inline-block' }}>
        View &rarr;
      </Link>
    </Section>
  )
}

function formatTimestamp(timestamp: string, timeZone?: string): string {
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return timestamp
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  try {
    // Render in the recipient's timezone so digest times match their local time.
    return date.toLocaleString('en-US', { ...options, timeZone: timeZone || FALLBACK_TIMEZONE })
  } catch {
    // Invalid timezone string — format without it rather than throwing.
    return date.toLocaleString('en-US', options)
  }
}
