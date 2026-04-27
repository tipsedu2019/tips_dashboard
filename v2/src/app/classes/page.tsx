import { redirect } from "next/navigation";

export default async function ClassesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(key, item));
      return;
    }
    if (value) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  if (!query) {
    redirect("/legacy-public/classes/index.html");
  }

  redirect(`/legacy-public/classes/index.html${query ? `?${query}` : ""}`);
}
