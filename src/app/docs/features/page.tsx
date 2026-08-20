'use client'

import { useAuth } from '@/hooks/use-auth'
import { Navigation } from '@/components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const featureInventory = [
  {
    category: 'Core feedback collection',
    features: [
      { name: 'Client feedback forms', description: 'Create forms that submit issues directly to Linear projects.', status: 'Available' },
      { name: 'Direct Linear integration', description: 'Two-way connection with your Linear workspace via API token.', status: 'Available' },
      { name: 'Custom form creation', description: 'Build tailored forms with configurable fields, labels, and defaults.', status: 'Available' },
      { name: 'Issue auto-creation', description: 'Submissions automatically create Linear issues with all metadata attached.', status: 'Available' },
      { name: 'Customer information capture', description: 'Collect name, email, and custom fields alongside each submission.', status: 'Available' },
      { name: 'Unlimited submissions', description: 'No caps on how many submissions a form can receive.', status: 'Available' },
    ],
  },
  {
    category: 'Sharing & collaboration',
    features: [
      { name: 'Shareable form links', description: 'Each form gets a unique URL you can send to clients.', status: 'Available' },
      { name: 'Public kanban view boards', description: 'Read-only boards showing project status grouped by Linear workflow states.', status: 'Available' },
      { name: 'Public roadmap sharing', description: 'Shareable roadmaps showing planned, in-progress, and completed work.', status: 'Available' },
      { name: 'Roadmap voting', description: 'Let clients vote on features to signal priority.', status: 'Available' },
      { name: 'Roadmap comments', description: 'Allow clients to leave comments on roadmap items.', status: 'Available' },
      { name: 'Password-protected roadmaps', description: 'Restrict roadmap access with a password.', status: 'Available' },
      { name: 'Kanban & timeline views', description: 'Choose between kanban columns or a timeline layout for roadmaps.', status: 'Available' },
      { name: 'Private project sharing', description: 'Share specific Linear projects without exposing the full workspace.', status: 'Available' },
      { name: 'Real-time Linear sync', description: 'Workspace-level webhook sync so hub views always reflect current Linear state.', status: 'Available' },
      { name: 'Stakeholder read-only access', description: 'Give stakeholders visibility without edit permissions.', status: 'Available' },
      { name: 'Cycle support', description: 'View and track Linear cycles within the hub.', status: 'Available' },
      { name: 'Label-based issue grouping', description: 'Group and filter issues by label within projects.', status: 'Available' },
      { name: 'Client-facing comments', description: 'Comments prefixed with heyclient in Linear are visible to clients in the hub.', status: 'Available' },
      { name: 'Hub member roles', description: 'Assign default (full access) or view-only roles to hub members.', status: 'Available' },
    ],
  },
  {
    category: 'Customisation & branding',
    features: [
      { name: 'Basic form customisation', description: 'Configure which fields appear and set default values.', status: 'Available' },
      { name: 'Custom branding/logos', description: 'Upload your logo to appear on all public-facing pages.', status: 'Available' },
      { name: 'White-label options', description: 'Remove Pulse branding for a fully white-labelled experience.', status: 'Available' },
      { name: 'Custom domains', description: 'Use your own domain (e.g. feedback.yourcompany.com) with DNS verification.', status: 'Available' },
      { name: 'Advanced styling options', description: 'Set primary brand colours applied across buttons, links, and accents.', status: 'Available' },
      { name: 'Theme customisation', description: 'Light and dark mode support with theme-aware branding.', status: 'Available' },
    ],
  },
  {
    category: 'Security & access control',
    features: [
      { name: 'Magic link authentication', description: 'Passwordless auth via WorkOS AuthKit with org-scoped access.', status: 'Available' },
      { name: 'Domain restrictions', description: 'Restrict form access to specific email domains.', status: 'Coming Soon' },
      { name: 'IP allowlisting', description: 'Limit access to forms and views by IP range.', status: 'Coming Soon' },
      { name: 'SSO integration', description: 'Single sign-on for enterprise teams.', status: 'Planned' },
      { name: 'Enterprise security compliance', description: 'SOC 2, GDPR, and other compliance certifications.', status: 'Planned' },
      { name: 'Audit logs', description: 'Track who accessed what and when.', status: 'Coming Soon' },
    ],
  },
  {
    category: 'Automation & AI',
    features: [
      { name: 'Webhook integration', description: 'Trigger external workflows when submissions or events occur.', status: 'Coming Soon' },
      { name: 'AI-generated changelogs', description: 'Automatically generate release notes from completed Linear issues.', status: 'Coming Soon' },
      { name: 'Automated notifications', description: 'Notify clients when their reported issues are resolved.', status: 'Coming Soon' },
      { name: 'Smart issue categorisation', description: 'AI-powered labelling and routing of incoming submissions.', status: 'Coming Soon' },
      { name: 'Auto-tagging', description: 'Automatically apply tags based on submission content.', status: 'Coming Soon' },
      { name: 'Workflow automation', description: 'Trigger actions based on issue status changes in Linear.', status: 'Coming Soon' },
    ],
  },
  {
    category: 'Analytics & reporting',
    features: [
      { name: 'Basic submission tracking', description: 'View submission counts and recent activity per form.', status: 'Available' },
      { name: 'Advanced analytics dashboard', description: 'Charts and trends for submissions, votes, and engagement.', status: 'Coming Soon' },
      { name: 'Custom reports', description: 'Build reports filtered by client, project, date range, etc.', status: 'Coming Soon' },
      { name: 'Export capabilities', description: 'Export submissions and analytics data to CSV/JSON.', status: 'Coming Soon' },
      { name: 'Performance metrics', description: 'Track resolution times and response rates.', status: 'Coming Soon' },
      { name: 'Usage insights', description: 'See which forms and views are most active.', status: 'Coming Soon' },
    ],
  },
  {
    category: 'Integrations',
    features: [
      { name: 'Linear integration', description: 'Core integration — all features built on top of the Linear API.', status: 'Available' },
      { name: 'Slack notifications', description: 'Get notified in Slack when new submissions arrive.', status: 'Coming Soon' },
      { name: 'Email notifications', description: 'Email alerts for new submissions and status changes.', status: 'Coming Soon' },
      { name: 'Zapier integration', description: 'Connect Pulse to thousands of apps via Zapier.', status: 'Coming Soon' },
      { name: 'API access', description: 'Programmatic access to forms, submissions, and views.', status: 'Coming Soon' },
      { name: 'Third-party tools', description: 'Integrations with other project management and communication tools.', status: 'Planned' },
    ],
  },
  {
    category: 'Support & maintenance',
    features: [
      { name: 'Direct support', description: 'Support via the PPM team for account and setup issues.', status: 'Available' },
      { name: 'Email support', description: 'Direct email support for account and setup issues.', status: 'Coming Soon' },
      { name: 'Priority support', description: 'Faster response times for paying customers.', status: 'Planned' },
      { name: 'Managed hosting', description: 'Hosted and managed by PPM on Vercel infrastructure.', status: 'Available' },
    ],
  },
  {
    category: 'Pricing & licensing',
    features: [
      { name: 'Free tier', description: 'All core features available at no cost.', status: 'Available' },
      { name: 'Private repository', description: 'Source code managed internally by PPM.', status: 'Available' },
      { name: 'No usage limits', description: 'Unlimited forms, views, roadmaps, and submissions.', status: 'Available' },
    ],
  },
]

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'Available':
      return <Badge variant="green" className="text-xs">{status}</Badge>
    case 'Coming Soon':
      return <Badge variant="blue" className="text-xs">{status}</Badge>
    case 'Planned':
      return <Badge variant="purple" className="text-xs">{status}</Badge>
    default:
      return <Badge variant="gray" className="text-xs">{status}</Badge>
  }
}

export default function FeaturesInventoryPage() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen gradient-bg">
        <Navigation />
        <div className="container mx-auto px-6 py-24 text-center text-muted-foreground">
          Loading...
        </div>
      </div>
    )
  }

  const totalAvailable = featureInventory.reduce((sum, cat) => sum + cat.features.filter(f => f.status === 'Available').length, 0)
  const totalComingSoon = featureInventory.reduce((sum, cat) => sum + cat.features.filter(f => f.status === 'Coming Soon').length, 0)
  const totalPlanned = featureInventory.reduce((sum, cat) => sum + cat.features.filter(f => f.status === 'Planned').length, 0)

  return (
    <div className="min-h-screen gradient-bg">
      <Navigation />

      <div className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-10">
          <Link href="/docs">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to docs
            </Button>
          </Link>
          <h1 className="text-3xl font-bold mb-2">Feature Inventory</h1>
          <p className="text-muted-foreground mb-4">
            Complete list of platform features and their current status.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Badge variant="green" className="text-xs">Available</Badge>
              <span className="text-sm text-muted-foreground">{totalAvailable}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="blue" className="text-xs">Coming Soon</Badge>
              <span className="text-sm text-muted-foreground">{totalComingSoon}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="purple" className="text-xs">Planned</Badge>
              <span className="text-sm text-muted-foreground">{totalPlanned}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {featureInventory.map((category) => (
            <Card key={category.category}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{category.category}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {category.features.map((feature) => (
                    <div key={feature.name} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-foreground">{feature.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{feature.description}</div>
                      </div>
                      <div className="shrink-0">
                        <StatusBadge status={feature.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
