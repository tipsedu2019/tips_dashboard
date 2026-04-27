import type { Metadata } from "next";

import { ClassScheduleWorkspace } from "@/features/operations/class-schedule-workspace";

export const metadata: Metadata = {
  title: "수업 설계 | TIPS Dashboard",
  description: "반별 수업계획·수업설계 검토를 위한 전용 작업 화면입니다.",
};

export default function CurriculumLessonDesignPage() {
  return <ClassScheduleWorkspace />;
}
