import { WidgetSubmissionsTable } from "@/components/admin/widget-submissions-table";

export default async function WidgetSubmissionsPage({
  params,
}: {
  params: Promise<{ hubId: string }>;
}) {
  const { hubId } = await params;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold">Widget Submissions</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        View feedback submitted through the Pulse widget
      </p>
      <div className="mt-6">
        <WidgetSubmissionsTable hubId={hubId} />
      </div>
    </div>
  );
}
