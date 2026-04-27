"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, Sparkles } from "lucide-react";

import { DotPattern } from "@/components/dot-pattern";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section
      id="hero"
      className="relative overflow-hidden bg-gradient-to-b from-background to-background/80 pb-16 pt-16 sm:pt-20"
    >
      <div className="absolute inset-0">
        <DotPattern className="opacity-100" size="md" fadeStyle="ellipse" />
      </div>

      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 flex justify-center">
            <Badge variant="outline" className="border-foreground px-4 py-2">
              <Sparkles className="mr-2 size-3 fill-current" />
              TIPS Dashboard v2 Preview
            </Badge>
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            공개 수업과 운영 화면을
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              {" "}하나의 흐름으로{" "}
            </span>
            연결하는 TIPS
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            학사일정, 수업 일정, 시간표, 수업 계획, 학생·수업·교재 관리까지 운영팀이 자주 쓰는 워크스페이스를 다시 정리하고,
            공개 수업 안내는 같은 데이터 계약 위에서 더 매끈하게 보여주는 리빌드입니다.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" className="text-base" asChild>
              <Link href="/classes">
                공개 수업 보기
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="text-base" asChild>
              <Link href="/admin/dashboard">
                <LayoutDashboard data-icon="inline-start" />
                관리자 열기
              </Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-20 max-w-6xl">
          <div className="group relative">
            <div className="absolute left-1/2 top-2 mx-auto h-24 w-[90%] -translate-x-1/2 transform rounded-full bg-primary/50 blur-3xl lg:-top-8 lg:h-80"></div>

            <div className="relative rounded-xl border bg-card shadow-2xl">
              <Image
                src="/dashboard-light.png"
                alt="TIPS Dashboard preview"
                width={1200}
                height={800}
                className="block w-full rounded-xl object-cover dark:hidden"
                priority
              />

              <Image
                src="/dashboard-dark.png"
                alt="TIPS Dashboard preview dark mode"
                width={1200}
                height={800}
                className="hidden w-full rounded-xl object-cover dark:block"
                priority
              />

              <div className="absolute bottom-0 left-0 h-32 w-full rounded-b-xl bg-gradient-to-b from-background/0 via-background/70 to-background md:h-40 lg:h-48"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
