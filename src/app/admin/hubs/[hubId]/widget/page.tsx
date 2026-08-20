import { WidgetConfigForm } from "@/components/admin/widget-config-form";

export default async function WidgetConfigPage({
  params,
}: {
  params: Promise<{ hubId: string }>;
}) {
  const { hubId } = await params;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold">Widget Configuration</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        Configure the Pulse feedback widget for your clients
      </p>
      <div className="mt-6 space-y-6">
        <WidgetConfigForm hubId={hubId} />
      </div>
    </div>
  );
}
