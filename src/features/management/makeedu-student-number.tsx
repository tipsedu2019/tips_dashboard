import { buildMakeEduStudentDetailUrl } from "./makeedu-student-link";

export function MakeEduStudentNumber({ uid, makeeduDetailId }: { uid: unknown; makeeduDetailId?: unknown }) {
  const label = typeof uid === "string" && uid.trim() ? uid.trim() : "—";
  const href = buildMakeEduStudentDetailUrl(makeeduDetailId);
  if (!href) return <span>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
      aria-label={`${label === "—" ? "" : `${label} `}MakeEdu 원생 상세 (새 탭)`}
      className="inline-flex min-h-11 items-center rounded-md text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {label === "—" ? "MakeEdu" : label}
    </a>
  );
}
