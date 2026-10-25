import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/data/auth";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Entrar", robots: PRIVATE_PAGE };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/conta");
  return <AuthForm mode="login" />;
}
