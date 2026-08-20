import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { resolveHubBySlug, getHubMembership } from "@/lib/hub-auth";
import { isPPMAdmin } from "@/lib/ppm-admin";
import { fetchHubTeams } from "@/lib/hub-read";
import { HubProvider, type HubTeam } from "@/contexts/hub-context";
import { HubShell } from "@/components/hub/hub-shell";

export default async function HubPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Resolve hub
  const hub = await resolveHubBySlug(slug);
  if (!hub) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-medium text-foreground">Portal not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This client portal does not exist or is no longer active.
          </p>
        </div>
      </div>
    );
  }

  // Check authentication
  const { user, organizationId } = await withAuth();

  if (!user) {
    redirect(`/hub/${slug}/login`);
  }

  // PPM admins bypass all org/membership checks
  const admin = await isPPMAdmin(user.id, user.email);

  if (!admin) {
    // Client users: verify session org matches this hub
    if (organizationId) {
      if (organizationId !== hub.workos_org_id) {
        redirect(`/hub/${slug}/login`);
      }
    } else {
      redirect(`/hub/${slug}/login`);
    }

    // Verify hub membership
    const membership = await getHubMembership(hub.id, user.id, user.email);
    if (!membership) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
            <h1 className="text-lg font-medium text-foreground">Access denied</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You are not a member of this portal. Contact your project manager
              for access.
            </p>
          </div>
        </div>
      );
    }
  }

  // Fetch teams for sidebar navigation
  const rawTeams = await fetchHubTeams(hub.id);
  const teams: HubTeam[] = rawTeams.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.key,
    color: t.color,
    icon: t.icon,
  }));

  return (
    <HubProvider
      hubId={hub.id}
      hubSlug={hub.slug}
      hubName={hub.name}
      teams={teams}
    >
      <HubShell>{children}</HubShell>
    </HubProvider>
  );
}
