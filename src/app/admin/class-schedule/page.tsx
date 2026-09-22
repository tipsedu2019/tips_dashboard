import { redirect } from "next/navigation";

export default async function ClassSchedulePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  redirect(`/admin/curriculum${query.size ? `?${query}` : ""}`);
}
