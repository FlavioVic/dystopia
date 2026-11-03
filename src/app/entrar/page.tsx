import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/data/auth";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Entrar", robots: PRIVATE_PAGE };

export default async function LoginPage({ searchParams }: PageProps<"/entrar">) {
  const user = await getCurrentUser();
  if (user) redirect("/conta");
  const { senha } = await searchParams;
  const notice = senha === "redefinida" ? "Senha redefinida. Entre com a senha nova." : undefined;
  return <AuthForm mode="login" notice={notice} />;
}
