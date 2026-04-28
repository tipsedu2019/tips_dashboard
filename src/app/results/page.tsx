import { Trophy } from "lucide-react";

import { PublicLayout } from "@/components/public/public-layout";

export default function ResultsPage() {
  const results = [
    { label: "내신", value: "100점·1등급", detail: "중등부터 고등까지 학교별 대비" },
    { label: "모의고사", value: "1등급", detail: "고등 영어 실전 관리" },
    { label: "수학", value: "상위권 진입", detail: "개념, 클리닉, 오답 루틴" },
    { label: "영어", value: "점수 상승", detail: "단어, 문법, 독해 반복 관리" },
  ];

  return (
    <PublicLayout
      eyebrow="RESULTS"
      title="점수로 확인하는 TIPS"
      description="시험 대비와 정기 관리의 결과를 과목별로 빠르게 확인합니다."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {results.map((item) => (
          <article key={item.label} className="rounded-lg border bg-card p-6">
            <Trophy className="mb-6 size-5 text-primary" />
            <p className="text-sm font-semibold text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{item.detail}</p>
          </article>
        ))}
      </div>
    </PublicLayout>
  );
}
