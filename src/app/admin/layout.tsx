import Link from "next/link";
import { requireAdmin } from "@/lib/data/auth";
import { AdminNav } from "@/components/admin/AdminNav";
import { HealthAlerts } from "@/components/admin/HealthAlerts";
import { getOperationalHealth } from "@/lib/data/orchestration";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  const health = await getOperationalHealth();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-accent px-2 py-0.5 font-mono text-xs font-bold text-accent-foreground">
            ADMIN
          </span>
          <h1 className="font-brand text-lg font-bold uppercase tracking-tight">Administração</h1>
        </div>
        <div className="flex items-center gap-4">
          <AdminNav />
          <Link href="/" className="hidden text-sm text-foreground-muted hover:text-foreground sm:inline">
            ← Loja
          </Link>
        </div>
      </div>
      <HealthAlerts alerts={health.alerts} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
