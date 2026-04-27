"use client";

import { CalendarClock, Globe2, LayoutDashboard, LibraryBig } from "lucide-react";

import { DotPattern } from "@/components/dot-pattern";
import { Card, CardContent } from "@/components/ui/card";

const stats = [
  {
    icon: LayoutDashboard,
    value: "8",
    label: "운영 메뉴",
    description: "관리자 주요 워크스페이스를 route 기반으로 재정리",
  },
  {
    icon: Globe2,
    value: "4",
    label: "공개 진입점",
    description: "홈, 수업, 후기, 성과 화면을 같은 톤으로 연결",
  },
  {
    icon: CalendarClock,
    value: "Live",
    label: "데이터 계약",
    description: "Supabase와 공개 payload를 같은 기준으로 재사용",
  },
  {
    icon: LibraryBig,
    value: "Shadcn",
    label: "UI 베이스",
    description: "검증된 template과 blocks를 우선 조합",
  },
];

export function StatsSection() {
  return (
    <section id="overview" className="relative py-12 sm:py-16">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/8 via-transparent to-secondary/20" />
      <DotPattern className="opacity-75" size="md" fadeStyle="circle" />

      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-6 md:gap-8 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <Card
              key={index}
              className="border-border/50 bg-background/60 py-0 text-center backdrop-blur-sm"
            >
              <CardContent className="p-6">
                <div className="mb-4 flex justify-center">
                  <div className="rounded-xl bg-primary/10 p-3">
                    <stat.icon className="size-6 text-primary" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold text-foreground sm:text-3xl">{stat.value}</h3>
                  <p className="font-semibold text-foreground">{stat.label}</p>
                  <p className="text-sm text-muted-foreground">{stat.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
