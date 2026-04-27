import { redirect } from "next/navigation";

export default async function LegacyClassScheduleLessonDesignRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item != null) {
          params.append(key, String(item));
        }
      });
      continue;
    }
    if (value != null) {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  redirect(query ? `/admin/curriculum/lesson-design?${query}` : "/admin/curriculum/lesson-design");
}
