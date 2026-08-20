import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hub = await resolveHubBySlug(slug);
  const hubName = hub?.name ?? slug;

  return {
    title: {
      default: hubName,
      template: `%s — ${hubName} | Pulse`,
    },
  };
}

export default function HubSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
