import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getHubDoc, getHubDocs } from "@/lib/hub-docs";
import { HubDocRenderer } from "@/components/hub/hub-doc-renderer";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const doc = await getHubDoc(topic);
  return { title: doc?.title ?? "Documentation" };
}

export default async function HubDocTopicPage({
  params,
}: {
  params: Promise<{ slug: string; topic: string }>;
}) {
  const { slug, topic } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  const doc = await getHubDoc(topic);
  if (!doc) notFound();

  const allDocs = await getHubDocs();
  const currentIndex = allDocs.findIndex((d) => d.slug === topic);
  const prev = currentIndex > 0 ? allDocs[currentIndex - 1] : null;
  const next = currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6">
        <Link
          href={`/hub/${slug}`}
          className="hover:text-foreground transition-colors"
        >
          {hub.name}
        </Link>
        <span>/</span>
        <Link
          href={`/hub/${slug}/docs`}
          className="hover:text-foreground transition-colors"
        >
          Documentation
        </Link>
        <span>/</span>
        <span className="text-foreground">{doc.title}</span>
      </div>

      {/* Content */}
      <HubDocRenderer content={doc.content} />

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
        {prev ? (
          <Link
            href={`/hub/${slug}/docs/${prev.slug}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; {prev.title}
          </Link>
        ) : <div />}
        {next ? (
          <Link
            href={`/hub/${slug}/docs/${next.slug}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {next.title} &rarr;
          </Link>
        ) : <div />}
      </div>
    </div>
  );
}
