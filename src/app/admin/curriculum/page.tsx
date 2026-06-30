import { AcademicCurriculumWorkspace } from "@/features/academic/curriculum-workspace";
import { ClassScheduleWorkspace } from "@/features/operations/class-schedule-workspace";

type CurriculumPageSearchParams = Record<string, string | string[] | undefined>;

function getSearchParam(params: CurriculumPageSearchParams | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function CurriculumEntryPage({
  searchParams,
}: {
  searchParams?: Promise<CurriculumPageSearchParams>;
}) {
  const params = await searchParams;
  if (getSearchParam(params, "lessonDesign") === "1") {
    return <ClassScheduleWorkspace />;
  }

  return <AcademicCurriculumWorkspace />;
}
