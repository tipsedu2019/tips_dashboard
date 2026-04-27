"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type FaqItem = {
  value: string;
  question: string;
  answer: string;
};

const faqItems: FaqItem[] = [
  {
    value: "item-1",
    question: "TIPS Dashboard v2는 어떤 방향으로 다시 만들고 있나요?",
    answer:
      "v1의 공개 화면과 관리자 기능을 Next.js App Router 위에서 다시 분리하고, 검증된 dashboard/landing 구조를 베이스로 삼아 route별 워크스페이스를 재구성하고 있습니다.",
  },
  {
    value: "item-2",
    question: "공개 수업 화면은 관리자 데이터와 연결되어 있나요?",
    answer:
      "네. 공개 수업은 `/api/public-classes`와 동일한 payload 계약을 유지하고, 가능하면 라이브 데이터를 우선 읽고 필요할 때만 snapshot으로 폴백하도록 연결되어 있습니다.",
  },
  {
    value: "item-3",
    question: "지금 바로 볼 수 있는 v2 관리자 메뉴는 무엇인가요?",
    answer:
      "대시보드, 학사일정, 수업 일정, 시간표, 수업 계획, 학생 관리, 수업 관리, 교재 관리 route가 준비되어 있고, 학생·수업·교재 관리는 이미 live management surface로 연결되어 있습니다.",
  },
  {
    value: "item-4",
    question: "템플릿은 어느 정도까지 그대로 사용하나요?",
    answer:
      "레이아웃, 사이드바, 카드, 테이블, landing 섹션처럼 검증된 surface는 최대한 재사용하고, 우리 도메인에 맞는 문구와 데이터 계약만 로컬 소유 코드로 바꾸는 방식을 기본으로 삼습니다.",
  },
  {
    value: "item-5",
    question: "기존 운영 데이터를 새로 옮겨야 하나요?",
    answer:
      "아니요. Phase 1 기준으로는 기존 Supabase auth와 데이터 스키마를 최대한 재사용하고, v2에서는 feature query layer를 두어 UI가 raw row를 직접 보지 않도록 정리하고 있습니다.",
  },
];

const FaqSection = () => {
  return (
    <section id="faq" className="py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">
            FAQ
          </Badge>
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            자주 묻는 질문
          </h2>
          <p className="text-lg text-muted-foreground">
            지금 보이는 v2 공개 화면과 운영 워크스페이스가 어떤 기준으로 재구성되고 있는지 빠르게 파악할 수 있도록 정리했습니다.
          </p>
        </div>

        <div className="mx-auto max-w-4xl">
          <div className="bg-transparent">
            <div className="p-0">
              <Accordion type="single" collapsible className="space-y-5">
                {faqItems.map((item) => (
                  <AccordionItem
                    key={item.value}
                    value={item.value}
                    className="rounded-md !border bg-transparent"
                  >
                    <AccordionTrigger className="cursor-pointer items-center gap-4 rounded-none bg-transparent py-2 ps-3 pe-4 hover:no-underline data-[state=open]:border-b">
                      <div className="flex items-center gap-4">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <CircleHelp className="size-5" />
                        </div>
                        <span className="text-start font-semibold">{item.question}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="bg-transparent p-4">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="mb-4 text-muted-foreground">
              상세 운영 화면은 관리자에서 계속 확장 중입니다.
            </p>
            <Button asChild>
              <Link href="/admin/dashboard">관리자 열기</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export { FaqSection };
