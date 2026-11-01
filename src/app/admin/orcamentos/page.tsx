import type { Metadata } from "next";
import { ServiceRequestStatus } from "@/components/admin/ServiceRequestStatus";
import { getServiceRequests } from "@/lib/data/admin";
import { requireAdmin } from "@/lib/data/auth";
import { serviceName } from "@/lib/services-catalog";

export const metadata: Metadata = { title: "Orçamentos · Admin" };

export default async function AdminServiceRequests() {
  await requireAdmin();
  const requests = await getServiceRequests();
  const open = requests.filter((r) => r.status === "novo").length;

  return (
    <div>
      <h2 className="label text-foreground-muted">
        Orçamentos ({String(requests.length).padStart(2, "0")}) · {String(open).padStart(2, "0")} novos
      </h2>

      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-foreground-muted">Nenhuma solicitação registrada.</p>
      ) : (
        <ul className="mt-4 flex flex-col border-t border-border-faint">
          {requests.map((r) => (
            <li key={r.id} className="grid gap-4 border-b border-border-faint py-5 lg:grid-cols-12">
              <div className="flex flex-col gap-1 lg:col-span-3">
                <span className="serial">{r.protocol}</span>
                <span className="label text-foreground-muted">{serviceName(r.kind)}</span>
                <span className="font-mono text-xs text-foreground-muted">
                  {new Date(r.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-sm lg:col-span-3">
                <span className="font-semibold">{r.name}</span>
                <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Orçamento ${r.protocol}`)}`} className="text-foreground-muted underline underline-offset-4 hover:text-foreground">
                  {r.email}
                </a>
                {r.phone ? <span className="font-mono text-xs text-foreground-muted">{r.phone}</span> : null}
              </div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-muted lg:col-span-4">{r.details}</p>
              <div className="lg:col-span-2">
                <ServiceRequestStatus id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
