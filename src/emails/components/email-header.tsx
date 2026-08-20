import { Img, Section, Text } from '@react-email/components'

interface EmailHeaderProps {
  hubName: string
  subtitle?: string
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function EmailHeader({ hubName, subtitle }: EmailHeaderProps) {
  return (
    <Section style={{ backgroundColor: '#F0F0FF', padding: '16px 32px', borderRadius: '8px 8px 0 0' }}>
      <Img
        src={`${getBaseUrl()}/pulse-logo.png`}
        width="32"
        height="32"
        alt="Pulse"
        style={{ marginBottom: '8px' }}
      />
      <Text style={{ color: '#3B3F8C', fontSize: '18px', fontWeight: 600, margin: '0' }}>
        {hubName}
      </Text>
      {subtitle && (
        <Text style={{ color: '#6B70A8', fontSize: '12px', margin: '4px 0 0' }}>
          {subtitle}
        </Text>
      )}
    </Section>
  )
}
