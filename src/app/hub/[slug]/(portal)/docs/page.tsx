import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { getHubDocs } from "@/lib/hub-docs";

export const metadata: Metadata = {
  title: "Documentation",
};

export default async function HubDocsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const docs = await getHubDocs();

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
          <Link
            href={`/hub/${slug}`}
            className="hover:text-foreground transition-colors"
          >
            {hub.name}
          </Link>
          <span>/</span>
          <span className="text-foreground">Documentation</span>
        </div>
        <h1 className="text-lg font-semibold">Documentation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Learn how to use your project hub.
        </p>
      </div>

      <div className="space-y-1">
        {docs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/hub/${slug}/docs/${doc.slug}`}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group"
          >
            <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium group-hover:text-primary transition-colors">
                {doc.title}
              </p>
              {doc.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {doc.description}
                </p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
