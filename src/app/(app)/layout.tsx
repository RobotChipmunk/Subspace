import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerFromSession, SESSION_COOKIE } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await ownerFromSession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  if (!owner) redirect("/login");
  return <Shell>{children}</Shell>;
}
