import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Img,
  Markdown,
  Preview,
} from '@react-email/components'
import { EmailHeader } from './components/email-header'
import { EmailFooter } from './components/email-footer'
import { formatMetadataEntries } from './components/format-metadata'

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export interface ImmediateNotificationProps {
  hubName: string
  hubSlug: string
  event: {
    type: string
    summary: string
    entityType: string
    entityId: string
    actorName?: string
    metadata?: Record<string, string>
  }
  deepLinkUrl: string
  /**
   * Canonical Linear issue URL. Only set for internal (PPM-domain) recipients
   * on new-task and comment events — clients never receive it (PULSE-372).
   */
  linearUrl?: string
}

export function ImmediateNotification({
  hubName,
  hubSlug,
  event,
  deepLinkUrl,
  linearUrl,
}: ImmediateNotificationProps) {
  const previewText = `${event.summary} — ${hubName}`
  const excerpt = event.metadata?.excerpt
  const visibleMeta = formatMetadataEntries(event.metadata)

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <EmailHeader hubName={hubName} subtitle={`${formatEventType(event.type)} · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`} />

          <Section style={content}>
            <Text style={summary}>
              {event.summary}
            </Text>

            {event.actorName && (
              <Text style={meta}>
                by {event.actorName}
              </Text>
            )}

            {(excerpt || visibleMeta.length > 0) && (
              <Section style={metadataSection}>
                {excerpt && (
                  // Comment bodies are Linear markdown — render them properly
                  // instead of dumping raw markdown into a single collapsed
                  // paragraph (PULSE-369).
                  <Markdown markdownCustomStyles={excerptMarkdownStyles}>
                    {withHardLineBreaks(excerpt)}
                  </Markdown>
                )}
                {visibleMeta.map((entry) => (
                  <Text key={entry.key} style={metadataLine}>
                    <span style={{ color: '#888888' }}>{entry.label}:</span> {entry.value}
                  </Text>
                ))}
              </Section>
            )}

            <Section style={linkRow}>
              <Img src={`${getBaseUrl()}/pulse-logo.png`} width="16" height="16" alt="" style={linkIcon} />
              <Link href={deepLinkUrl} style={viewLink}>
                View issue on Pulse &rarr;
              </Link>
            </Section>

            {linearUrl && (
              <Section style={linkRow}>
                <Img src={`${getBaseUrl()}/linear-logo.png`} width="16" height="16" alt="" style={linkIcon} />
                <Link href={linearUrl} style={linearLink}>
                  View in Linear &rarr;
                </Link>
              </Section>
            )}
          </Section>

          <EmailFooter hubSlug={hubSlug} />
        </Container>
      </Body>
    </Html>
  )
}

// Linear renders single newlines as hard line breaks (like GitHub comments),
// but CommonMark treats them as soft wraps. Convert lone newlines to markdown
// hard breaks (trailing double space) so "Thanks,\nSterna" keeps its line break.
function withHardLineBreaks(markdown: string): string {
  return markdown.replace(/(?<!\n)\n(?!\n)/g, "  \n")
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

const summary = {
  color: '#1a1a1a',
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 500 as const,
  margin: '0 0 4px',
} as const

const meta = {
  color: '#888888',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 16px',
} as const

const metadataSection = {
  backgroundColor: '#fafafa',
  borderRadius: '6px',
  padding: '12px 16px',
  margin: '12px 0 20px',
} as const

const excerptText = {
  color: '#444444',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 10px',
} as const

// Styles applied per markdown element when rendering comment bodies.
const excerptMarkdownStyles = {
  p: excerptText,
  li: { ...excerptText, margin: '0 0 4px' },
  ul: { margin: '4px 0 10px', paddingLeft: '20px' },
  ol: { margin: '4px 0 10px', paddingLeft: '20px' },
  link: { color: '#5E6AD2', textDecoration: 'underline' },
  bold: { fontWeight: 600 },
  h1: { ...excerptText, fontSize: '16px', fontWeight: 600, margin: '12px 0 6px' },
  h2: { ...excerptText, fontSize: '15px', fontWeight: 600, margin: '12px 0 6px' },
  h3: { ...excerptText, fontSize: '14px', fontWeight: 600, margin: '12px 0 6px' },
  blockQuote: {
    borderLeft: '3px solid #e4e4e7',
    margin: '0 0 10px',
    padding: '2px 0 2px 12px',
    color: '#666666',
  },
  codeInline: {
    fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '13px',
    backgroundColor: '#f0f0f1',
    padding: '1px 4px',
    borderRadius: '3px',
  },
  image: { maxWidth: '100%', borderRadius: '4px' },
  hr: { border: 'none', borderTop: '1px solid #e4e4e7', margin: '12px 0' },
} as const

const metadataLine = {
  color: '#444444',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '2px 0',
} as const

// Each link sits on its own row with its icon to the left. The row owns the
// vertical spacing; the link itself is inline so it aligns with the icon.
const linkRow = {
  marginTop: '10px',
} as const

const linkIcon = {
  display: 'inline-block' as const,
  verticalAlign: 'middle' as const,
  marginRight: '8px',
} as const

const viewLink = {
  color: '#5E6AD2',
  fontSize: '13px',
  fontWeight: 500 as const,
  textDecoration: 'none',
  display: 'inline-block' as const,
  verticalAlign: 'middle' as const,
} as const

// Secondary, internal-only link (PPM-domain recipients) — visually quieter
// than the primary Pulse link.
const linearLink = {
  ...viewLink,
  color: '#888888',
} as const

export default ImmediateNotification
