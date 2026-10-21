import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/data/auth";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/conta");
  return <AuthForm mode="signup" />;
}
