import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";

const docsDir = path.join(process.cwd(), "docs", "admin");

export async function generateStaticParams() {
  if (!fs.existsSync(docsDir)) return [];
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  return files.map((f) => ({ slug: f.replace(/\.md$/, "") }));
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/i.test(slug);
}

function resolveDocPath(slug: string): string | null {
  if (!isValidSlug(slug)) return null;
  const filePath = path.resolve(docsDir, `${slug}.md`);
  if (!filePath.startsWith(path.resolve(docsDir))) return null;
  return filePath;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const filePath = resolveDocPath(slug);
  if (!filePath || !fs.existsSync(filePath)) return { title: "Not Found" };

  const content = fs.readFileSync(filePath, "utf-8");
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : slug.replace(/-/g, " ");

  return { title: `${title} | Admin Docs` };
}

export default async function AdminDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const filePath = resolveDocPath(slug);

  if (!filePath || !fs.existsSync(filePath)) {
    notFound();
  }

  const content = fs.readFileSync(filePath, "utf-8");

  return (
    <div className="p-6 max-w-3xl">
      <Link
        href="/admin/docs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All docs
      </Link>

      <article
        className="prose prose-sm dark:prose-invert max-w-none
          prose-headings:font-semibold
          prose-h1:text-xl prose-h1:mb-4 prose-h1:pb-3 prose-h1:border-b prose-h1:border-border
          prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3
          prose-h3:text-sm prose-h3:mt-6 prose-h3:mb-2 prose-h3:font-semibold
          prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:text-sm
          prose-li:text-muted-foreground prose-li:text-sm
          prose-strong:text-foreground prose-strong:font-semibold
          prose-code:text-xs prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-muted/50 prose-pre:text-foreground prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:text-xs
          prose-table:text-xs
          prose-th:text-foreground prose-th:font-semibold prose-th:border-border prose-th:px-3 prose-th:py-2
          prose-td:text-muted-foreground prose-td:border-border prose-td:px-3 prose-td:py-2
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
          prose-hr:border-border
        "
      >
        <MarkdownRenderer content={content} />
      </article>
    </div>
  );
}
