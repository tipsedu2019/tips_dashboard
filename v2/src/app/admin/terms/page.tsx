import { redirect } from "next/navigation";

export default function TermsPage() {
  redirect("/admin/settings/class-groups");
}
