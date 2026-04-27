import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  MessageSquareQuote,
  Presentation,
  Sparkles,
  Trophy,
} from "lucide-react";

import { PublicLayout } from "@/components/public/public-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const quickLinks = [
  {
    title: "수업 소개",
    href: "/classes",
    description: "현재 공개 중인 수업과 기본 정보 구조를 먼저 확인합니다.",
    icon: BookOpen,
  },
  {
    title: "리뷰",
    href: "/reviews",
    description: "검증된 리뷰 마이크로사이트를 v2 public shell 안으로 재사용합니다.",
    icon: MessageSquareQuote,
  },
  {
    title: "결과",
    href: "/results",
    description: "기존 공개 결과 경험을 유지한 채 route parity를 확보합니다.",
    icon: Trophy,
  },
  {
    title: "관리자",
    href: "/admin/dashboard",
    description: "운영 현황, 학사 일정, 수업 관리 화면으로 바로 이동합니다.",
    icon: Presentation,
  },
];

export function PublicHomePage() {
  return (
    <PublicLayout
      eyebrow="TIPS"
      title="입시·학사 운영을 한 곳에서 연결하는 TIPS Dashboard"
      description="공개 페이지와 관리자 워크스페이스를 분리해 수업 소개, 리뷰, 성과, 운영 관리 동선을 자연스럽게 이어주는 통합 포털입니다."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_1fr]">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="space-y-4">
              <Badge variant="secondary" className="w-fit">
                <Sparkles className="mr-2 size-3.5" />
                검증된 공개 자산 연동
              </Badge>
              <div className="space-y-2">
                <CardTitle>공개 홈 이관 기준</CardTitle>
                <CardDescription>
                  현재 홈 화면은 검증된 공개 자산을 안정적으로 연결하면서도, v2 공용 셸 안에서 일관된 탐색 경험을 제공합니다.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                필요한 섹션은 점진적으로 네이티브 Next UI로 다듬되, 이미 잘 동작하는 공개 경험은 유지합니다.
              </p>
            </CardContent>
          </Card>

          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.href} className="border-border/60 shadow-sm">
                <CardHeader className="space-y-4">
                  <Badge variant="outline" className="w-fit">
                    <Icon className="mr-2 size-3.5" />
                    바로 사용 가능
                  </Badge>
                  <div className="space-y-2">
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full justify-between">
                    <Link href={item.href}>
                      열기
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="overflow-hidden border-border/60 shadow-sm">
          <div className="aspect-[16/10] min-h-[560px] bg-muted/20">
            <iframe
              title="TIPS home microsite"
              src="/embedded/home/index.html"
              className="h-full w-full border-0 bg-background"
            />
          </div>
        </Card>
      </div>
    </PublicLayout>
  );
}
