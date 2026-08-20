import type { Metadata } from "next";
import { resolveHubBySlug } from "@/lib/hub-auth";
import { redirect } from "next/navigation";
import { NotificationPreferencesForm } from "@/components/hub/notification-preferences-form";
import { Bell } from "lucide-react";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function HubSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hub = await resolveHubBySlug(slug);
  if (!hub) redirect(`/hub/${slug}/login`);

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your notification preferences
        </p>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Notifications</h2>
        </div>
        <NotificationPreferencesForm />
      </section>
    </div>
  );
}
