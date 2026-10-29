import { buttonCompact } from "@/components/Kit";
import Link from "next/link";
import { requireAdmin } from "@/lib/data/auth";
import { AdminNav } from "@/components/admin/AdminNav";
import { HealthAlerts } from "@/components/admin/HealthAlerts";
import { getOperationalHealth } from "@/lib/data/orchestration";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  const health = await getOperationalHealth();

  return (
    <div className="mx-auto max-w-site px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <span className="dys-label dys-label--restricted">Restrito</span>
          <h1 className="display-4">Comando</h1>
        </div>
        {/* min-w-0 + max-w-full: sem isso a nav cresce até o conteúdo e o
            overflow-x-auto dela nunca entra — a página estoura no celular. */}
        <div className="flex min-w-0 max-w-full items-center gap-4">
          <AdminNav />
          <Link href="/" className={`hidden sm:inline-flex ${buttonCompact}`}>
            <span aria-hidden="true">←</span> Voltar à loja
          </Link>
        </div>
      </div>
      <HealthAlerts alerts={health.alerts} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
