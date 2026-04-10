import { TokenConnectionForm } from "@/components/admin/token-connection-form";
import { OAuthConnectionForm } from "@/components/admin/oauth-connection-form";
import { AdminLinearConnection } from "@/components/admin/admin-linear-connection";
import { Suspense } from "react";

export default function LinearSettingsPage() {
  return (
    <div className="p-6 space-y-10">
      <TokenConnectionForm />
      <div className="border-t border-border" />
      <OAuthConnectionForm />
      <div className="border-t border-border" />
      <Suspense>
        <AdminLinearConnection />
      </Suspense>
    </div>
  );
}
