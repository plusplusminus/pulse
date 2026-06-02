import { Section, Text, Link } from '@react-email/components'
import { formatMetadataEntries } from './format-metadata'

interface EventRowProps {
  summary: string
  timestamp: string
  deepLinkUrl: string
  actorName?: string
  metadata?: Record<string, unknown>
}

export function EventRow({ summary, timestamp, deepLinkUrl, actorName, metadata }: EventRowProps) {
  const entries = formatMetadataEntries(metadata)
  const projectEntry = entries.find((e) => e.key.toLowerCase() === 'project')
  const detailEntries = entries.filter((e) => e.key.toLowerCase() !== 'project')

  // Context line: Project first, then clean metadata labels, then actor · date.
  const parts: string[] = []
  if (projectEntry) parts.push(projectEntry.value)
  for (const entry of detailEntries) parts.push(`${entry.label}: ${entry.value}`)
  if (actorName) parts.push(actorName)
  parts.push(formatTimestamp(timestamp))

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

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return timestamp
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
