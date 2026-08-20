import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { isPPMAdmin } from "@/lib/ppm-admin";
import { AdminShell } from "@/components/admin/admin-shell";

export const metadata = {
  title: {
    default: "Admin",
    template: "%s — Admin | Pulse",
  },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/login");

  const isAdmin = await isPPMAdmin(user.id, user.email);
  if (!isAdmin) redirect("/");

  return (
    <AdminShell user={{ id: user.id, email: user.email ?? "", firstName: user.firstName ?? null }}>
      {children}
    </AdminShell>
  );
}
