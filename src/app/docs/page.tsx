import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import { Navigation } from '@/components/navigation'
import { Card, CardContent } from '@/components/ui/card'
import {
  Users,
  Code,
  FileText,
  ArrowRight,
} from 'lucide-react'

type DocEntry = {
  slug: string
  title: string
  description: string
}

function getMarkdownDocs(folder: string): DocEntry[] {
  const docsDir = path.join(process.cwd(), 'docs', folder)
  if (!fs.existsSync(docsDir)) return []

  return fs.readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(docsDir, f), 'utf-8')
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : f.replace(/\.md$/, '').replace(/-/g, ' ')

      // Use the first paragraph after the title as description
      const descMatch = content.match(/^#\s+.+\n+(?:##\s+\w+\n+)?(.+)/m)
      const description = descMatch
        ? descMatch[1].slice(0, 120) + (descMatch[1].length > 120 ? '...' : '')
        : ''

      return {
        slug: f.replace(/\.md$/, ''),
        title,
        description,
      }
    })
}

type DocCategory = {
  name: string
  description: string
  icon: typeof Users
} & (
  | { type: 'rich'; docs: { title: string; description: string; href: string }[] }
  | { type: 'markdown'; folder: string }
)

const categories: DocCategory[] = [
  {
    name: 'Product',
    description: 'How Pulse works for you and your clients.',
    icon: Users,
    type: 'rich',
    docs: [
      {
        title: 'Customer Experience',
        description: 'What your clients see when they interact with forms, views, and roadmaps.',
        href: '/docs/customer-experience',
      },
      {
        title: 'Feature Inventory',
        description: 'Complete list of platform features and their current status.',
        href: '/docs/features',
      },
    ],
  },
  {
    name: 'Development',
    description: 'Architecture, sync mechanisms, and technical reference.',
    icon: Code,
    type: 'markdown',
    folder: 'development',
  },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen gradient-bg">
      <Navigation />

      <div className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Documentation</h1>
          <p className="text-muted-foreground">
            Product guides and technical reference for the Pulse team.
          </p>
        </div>

        <div className="space-y-10">
          {categories.map((category) => {
            const Icon = category.icon
            const docs = category.type === 'markdown'
              ? getMarkdownDocs(category.folder).map(doc => ({
                  title: doc.title,
                  description: doc.description,
                  href: `/docs/${category.folder}/${doc.slug}`,
                }))
              : category.docs

            return (
              <div key={category.name}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-semibold">{category.name}</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{category.description}</p>

                <div className="grid gap-3">
                  {docs.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No docs yet.</p>
                  ) : (
                    docs.map((doc) => (
                      <Link key={doc.href} href={doc.href}>
                        <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                          <CardContent className="flex items-center justify-between py-4">
                            <div className="flex items-start gap-3 min-w-0">
                              <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <div className="font-medium text-sm">{doc.title}</div>
                                {doc.description && (
                                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {doc.description}
                                  </div>
                                )}
                              </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 ml-4" />
                          </CardContent>
                        </Card>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
