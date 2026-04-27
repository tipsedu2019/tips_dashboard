import { redirect } from "next/navigation";

export default function LegacyAdminRedirectPage() {
  redirect("/admin/dashboard");
}
