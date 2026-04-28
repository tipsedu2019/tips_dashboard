import { MessageSquareQuote } from "lucide-react";

import { PublicLayout } from "@/components/public/public-layout";

export default function ReviewsPage() {
  const reviews = [
    "단어, 숙제, 테스트를 그냥 넘기지 않아서 공부 습관이 잡혔어요.",
    "내신 기간에 학교별 자료를 끝까지 맞춰줘서 시험 준비가 훨씬 편했습니다.",
    "처음에는 수학이 두려웠는데 질문하기 편한 분위기라 계속 다닐 수 있었어요.",
    "상담과 피드백이 꾸준해서 아이의 부족한 부분을 바로 알 수 있었습니다.",
  ];

  return (
    <PublicLayout
      eyebrow="REVIEWS"
      title="학생과 학부모가 남긴 변화"
      description="수업 태도, 시험 대비, 성적 향상에 대한 실제 후기를 v2 화면에서 바로 확인합니다."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {reviews.map((review, index) => (
          <article key={review} className="rounded-lg border bg-card p-6">
            <MessageSquareQuote className="mb-6 size-5 text-primary" />
            <p className="text-lg font-medium leading-8">{review}</p>
            <p className="mt-5 text-sm text-muted-foreground">
              TIPS 후기 {String(index + 1).padStart(2, "0")}
            </p>
          </article>
        ))}
      </div>
    </PublicLayout>
  );
}
