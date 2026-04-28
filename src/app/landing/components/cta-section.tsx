"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function CTASection() {
  return (
    <section className="bg-muted/80 py-16 lg:py-24">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <div className="space-y-8">
              <div className="flex flex-col items-center gap-4">
                <Badge variant="outline" className="flex items-center gap-2">
                  <Sparkles className="size-3" />
                  Public + Admin Flow
                </Badge>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <div className="size-2 rounded-full bg-green-500" />
                    `/classes` live payload
                  </span>
                  <Separator orientation="vertical" className="!h-4" />
                  <span>`/admin/*` route shell</span>
                  <Separator orientation="vertical" className="!h-4" />
                  <span>Next.js + shadcn/ui</span>
                </div>
              </div>

              <div className="space-y-6">
                <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                  운영팀은 관리자에서,
                  <span className="flex justify-center sm:inline-flex">
                    <span className="relative mx-2">
                      <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                        학생과 학부모는 공개 화면에서
                      </span>
                      <div className="absolute start-0 -bottom-2 h-1 w-full bg-gradient-to-r from-primary/30 to-secondary/30" />
                    </span>
                    바로 시작합니다
                  </span>
                </h1>

                <p className="mx-auto max-w-2xl text-balance text-muted-foreground lg:text-xl">
                  v2는 운영 업무와 공개 안내가 서로 다른 톤으로 흩어지지 않도록, 같은 디자인 언어와 데이터 계약 안에서 다시 쌓아가는 중입니다.
                </p>
              </div>

              <div className="flex flex-col justify-center gap-4 sm:flex-row sm:gap-6">
                <Button size="lg" className="px-8 py-6 text-lg font-medium" asChild>
                  <Link href="/admin/dashboard">
                    <LayoutDashboard data-icon="inline-start" />
                    관리자 열기
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="group px-8 py-6 text-lg font-medium"
                  asChild
                >
                  <Link href="/classes">
                    공개 수업 보기
                    <ArrowRight
                      data-icon="inline-end"
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </Link>
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="me-1 size-2 rounded-full bg-green-600 dark:bg-green-400" />
                  <span>공개 라우트 유지</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="me-1 size-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  <span>기존 auth 재사용</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="me-1 size-2 rounded-full bg-purple-600 dark:bg-purple-400" />
                  <span>template-first UI</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
