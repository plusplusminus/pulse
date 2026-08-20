import { redirect } from "next/navigation";

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ slug: string; teamKey: string }>;
}) {
  const { slug, teamKey } = await params;
  redirect(`/hub/${slug}/${teamKey}?tab=roadmap`);
}
