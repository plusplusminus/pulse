'use client'

import { useAuth } from '@/hooks/use-auth'
import { Navigation } from '@/components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  FileText,
  Eye,
  Map,
  Lock,

  MessageSquare,
  Filter,
  Columns3,
  CalendarRange,
  Paintbrush,
  Search,
  ChevronUp,
  Activity,
} from 'lucide-react'
import Link from 'next/link'

export default function CustomerExperiencePage() {
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
          <h1 className="text-3xl font-bold mb-2">Customer Experience</h1>
          <p className="text-muted-foreground">
            What your clients see and can do when they interact with your hub — projects, roadmaps, forms, and more. Clients sign in via magic link (WorkOS AuthKit).
          </p>
        </div>

        <div className="space-y-8">

          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How it works for customers</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                Your clients never see Linear directly. Instead, they access a branded hub portal with teams, projects, roadmaps, and forms — all synced from your Linear workspace. Branding is applied throughout.
              </p>
              <div className="grid sm:grid-cols-3 gap-3 pt-1">
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    Forms
                  </div>
                  <p className="text-xs">Submit feedback, bugs, and requests</p>
                </div>
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Eye className="h-4 w-4 text-primary" />
                    Views
                  </div>
                  <p className="text-xs">See project progress on a kanban board</p>
                </div>
                <div className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Map className="h-4 w-4 text-primary" />
                    Roadmaps
                  </div>
                  <p className="text-xs">See what&apos;s planned, vote, and comment</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* === FORMS === */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Feedback Forms
            </h2>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">What the customer sees</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    A clean, single-column form centred on the page. If you&apos;ve configured branding, your logo, colours, and fonts are applied — no Pulse branding visible (if disabled).
                  </p>
                  <p>The form collects:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-foreground">Name</strong> and <strong className="text-foreground">email</strong> — identifies the submitter</li>
                    <li><strong className="text-foreground">Reference ID</strong> — optional, useful for linking to an external ticket or account</li>
                    <li><strong className="text-foreground">Issue title</strong> and <strong className="text-foreground">description</strong> — the actual feedback</li>
                    <li><strong className="text-foreground">Attachment URL</strong> — link to a screenshot, recording, etc.</li>
                  </ul>
                  <p>
                    On submission, a Linear issue is created in your chosen project. The customer sees a success message with a reference ID — they never see Linear internals.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    Prefill links
                    <Badge variant="blue" className="text-xs">Useful</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    Every field can be pre-populated via URL query parameters. This lets you create contextual links that reduce friction for the customer:
                  </p>
                  <div className="bg-muted rounded-lg p-3 font-mono text-xs break-all">
                    /form/your-slug?name=Jane&email=jane@co.com&title=Bug%20report&ref=ACCT-123
                  </div>
                  <p>
                    Useful for embedding a &quot;Report a bug&quot; link in your app where the customer&apos;s name and email are already known.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* === VIEWS === */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Public Views (Kanban Boards)
            </h2>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">What the customer sees</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    A full-screen kanban board that mirrors your Linear project&apos;s workflow. Issues are grouped into columns by status (Backlog → Unstarted → Started → Completed → Cancelled), matching Linear&apos;s exact state icons and ordering.
                  </p>
                  <p>Each issue card shows:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Issue identifier (e.g. PRJ-123) and status icon</li>
                    <li>Issue title</li>
                    <li>Priority indicator</li>
                    <li>Labels as coloured badges</li>
                    <li>Assignee initials (if configured)</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Filtering & search
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    Customers can filter issues using a dropdown that closely mirrors Linear&apos;s own filter UI. Available filters:
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {['Status', 'Assignee', 'Priority', 'Labels'].map((filter) => (
                      <div key={filter} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{filter}</span>
                      </div>
                    ))}
                  </div>
                  <p>
                    Active filters show as pill indicators in the toolbar. A search-as-you-type input lets customers find specific issues quickly.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    Issue detail panel
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    Clicking any card opens a slide-in panel from the right showing:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-foreground">Full description</strong> — rendered as Markdown (supports code blocks, tables, images, checkboxes)</li>
                    <li><strong className="text-foreground">Metadata</strong> — priority, assignee, labels</li>
                    <li><strong className="text-foreground">Activity log</strong> — status changes, assignee changes, priority changes, and comments (read-only)</li>
                  </ul>
                  <p>
                    <strong className="text-foreground">Note:</strong> Only comments prefixed with <code className="text-foreground bg-muted px-1 rounded">heyclient</code> in Linear are visible to clients. Internal team comments remain private.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Project updates
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    If the view is linked to a Linear project, customers can click the &quot;Updates&quot; button to see a chronological log of project status updates pulled from Linear. Each entry shows:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Health status — <span className="text-green-600 font-medium">On track</span>, <span className="text-amber-600 font-medium">At risk</span>, or <span className="text-red-600 font-medium">Off track</span></li>
                    <li>Author and date</li>
                    <li>Full update body (Markdown)</li>
                    <li>Change diffs (if present in Linear)</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Issue creation (optional)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    If you enable <strong className="text-foreground">allow issue creation</strong> on a view, a &quot;New issue&quot; button appears in the toolbar. Customers can create issues directly from the board — clicking a column header pre-selects that status. This is useful when you want the view to serve as both a tracker and an intake point.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* === ROADMAPS === */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Map className="h-5 w-5 text-primary" />
              Public Roadmaps
            </h2>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">What the customer sees</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    A high-level view of planned and in-progress work. Customers can switch between two layouts:
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3 pt-1">
                    <div className="rounded-lg border border-border p-3 space-y-1">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <Columns3 className="h-4 w-4 text-primary" />
                        Kanban
                      </div>
                      <p className="text-xs">Issues grouped into configurable status columns. Items sorted by vote count (most-voted first).</p>
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-1">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <CalendarRange className="h-4 w-4 text-primary" />
                        Timeline
                      </div>
                      <p className="text-xs">Issues placed on a 12-period timeline (months or quarters) based on due date. Current period is highlighted.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Roadmap item cards</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>Each item on the roadmap shows:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-foreground">Vote button</strong> — chevron-up with count (if voting enabled)</li>
                    <li><strong className="text-foreground">Project badge</strong> — colour-coded pill showing which project the item belongs to</li>
                    <li><strong className="text-foreground">Title</strong> and truncated description</li>
                    <li><strong className="text-foreground">Due date</strong>, comment count, and up to 2 label chips</li>
                  </ul>
                  <p>
                    Clicking a card opens a detail panel with the full description, labels, status, due date, and the comments section.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ChevronUp className="h-4 w-4" />
                    Voting
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    When voting is enabled, customers can upvote roadmap items to signal priority. Key behaviours:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-foreground">No account required</strong> — votes are deduplicated using a browser fingerprint (user agent, screen size, timezone, etc.)</li>
                    <li><strong className="text-foreground">Toggle</strong> — clicking again removes the vote</li>
                    <li><strong className="text-foreground">Persisted locally</strong> — vote state is saved in the browser so it persists across page reloads</li>
                    <li><strong className="text-foreground">Instant feedback</strong> — vote count updates immediately with an animation</li>
                  </ul>
                  <p>
                    Items are sorted by vote count within each column, so the most-requested features naturally rise to the top.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Comments
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    When comments are enabled, the item detail panel includes a comment form where customers can leave feedback. They provide:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-foreground">Name</strong> (required) and <strong className="text-foreground">email</strong> (configurable)</li>
                    <li><strong className="text-foreground">Comment body</strong> (up to 2,000 characters)</li>
                  </ul>
                  <p>
                    Name and email are remembered in the browser for next time. Comments appear immediately with optimistic UI — if you&apos;ve enabled moderation, the comment is held for review and the customer sees a confirmation message.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* === CROSS-CUTTING === */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              Across all pages
            </h2>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Password protection
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    Views and roadmaps can be password-protected. When enabled, customers see a lock screen with a password field before they can access any content. Incorrect passwords show an inline error.
                  </p>
                  <p>
                    Forms do <strong className="text-foreground">not</strong> support password protection — they&apos;re intended to be freely accessible submission endpoints.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Paintbrush className="h-4 w-4" />
                    Branding
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    All three page types support the full branding system. What customers see when branding is applied:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Your logo replaces all Pulse branding</li>
                    <li>Your primary colour on buttons, links, and accents</li>
                    <li>Custom body and heading fonts</li>
                    <li>Custom favicon</li>
                    <li>Custom footer text</li>
                    <li>&quot;Powered by Pulse&quot; removed (if toggled off)</li>
                  </ul>
                  <p>
                    Branding is configured per hub in the admin settings and applies across all hub pages.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Authentication</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>
                    Hub access requires authentication via WorkOS AuthKit. Clients sign in using a magic link sent to their email — no password to remember. Each client is scoped to their hub through a WorkOS Organization, and roles (<strong className="text-foreground">default</strong> or <strong className="text-foreground">view-only</strong>) control what they can do.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
