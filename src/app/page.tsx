import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/server";

export default async function Home() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  redirect(ctx.role === "customer" ? "/portal" : "/dashboard");
}
