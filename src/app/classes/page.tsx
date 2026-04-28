import { PublicClassesView } from "@/components/public/public-classes-view";
import { loadPublicClassesPagePayload } from "@/lib/public-classes-server";

export default async function ClassesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const payload = await loadPublicClassesPagePayload();
  const subjectParam = Array.isArray(resolvedSearchParams.subject)
    ? resolvedSearchParams.subject[0]
    : resolvedSearchParams.subject;
  const gradeParam = Array.isArray(resolvedSearchParams.grade)
    ? resolvedSearchParams.grade[0]
    : resolvedSearchParams.grade;

  return (
    <PublicClassesView
      classes={payload.classes || []}
      initialSubject={subjectParam || ""}
      initialGrade={gradeParam || ""}
    />
  );
}
