import { BookOpen } from "lucide-react";
import { StateView } from "./ui/tds";

export default function CurriculumRoadmapPlaceholderView() {
  return (
    <div
      className="view-container curriculum-roadmap-placeholder-view"
      data-testid="curriculum-roadmap-placeholder"
    >
      <section className="workspace-surface curriculum-roadmap-placeholder-surface">
        <StateView
          center
          className="curriculum-roadmap-placeholder-state"
          icon={<BookOpen size={28} aria-hidden="true" />}
          title="교재진도 재설계 준비 중"
          description="기존 학교 연간일정표는 학사일정으로 이동했습니다. 교재진도는 새 정보구조로 다시 설계할 예정입니다."
        />
      </section>
    </div>
  );
}
