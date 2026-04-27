"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Database,
  LayoutDashboard,
  LibraryBig,
  Route,
  Users,
} from "lucide-react";

import { Image3D } from "@/components/image-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const mainFeatures = [
  {
    icon: CalendarDays,
    title: "학사일정과 수업 일정을 분리",
    description: "예외 일정과 운영 타임라인을 각각 다른 route와 workspace로 정리합니다.",
  },
  {
    icon: Users,
    title: "학생·수업·교재를 같은 shell에서 관리",
    description: "테이블, 필터, 상태 뱃지를 같은 시각 규칙으로 묶어 관리 피로를 줄입니다.",
  },
  {
    icon: Database,
    title: "같은 데이터 계약을 재사용",
    description: "공개 수업 payload와 관리자 Supabase 쿼리를 분리된 layer로 유지합니다.",
  },
  {
    icon: LibraryBig,
    title: "직접 만들기보다 block을 우선 사용",
    description: "template surface와 shadcn/ui primitives를 조합해 빠르게 화면을 확장합니다.",
  },
];

const secondaryFeatures = [
  {
    icon: LayoutDashboard,
    title: "운영 대시보드",
    description: "수업 수, 학생 수, 진도 로그와 연결된 상태를 한 화면에서 확인합니다.",
  },
  {
    icon: Route,
    title: "route 기반 재구성",
    description: "v1의 view switching을 Next App Router 기준으로 다시 나눕니다.",
  },
  {
    icon: BookOpen,
    title: "공개 수업 랜딩 연결",
    description: "홈에서 바로 공개 수업, 후기, 성과로 이어지는 진입 흐름을 제공합니다.",
  },
  {
    icon: Users,
    title: "권한과 운영 역할 재사용",
    description: "기존 auth와 role 정책을 유지하면서 v2 surface만 교체합니다.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="bg-muted/30 py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">
            운영 UI 리빌드
          </Badge>
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            템플릿은 그대로 두고 도메인만 TIPS에 맞게 다시 조립합니다
          </h2>
          <p className="text-lg text-muted-foreground">
            검증된 dashboard와 landing 구조를 베이스로 쓰되, 실제 운영 흐름은 TIPS의 공개 수업·학사일정·학생·교재 관리 시나리오에 맞게 다시 엮었습니다.
          </p>
        </div>

        <div className="mb-24 grid items-center gap-12 lg:grid-cols-2 lg:gap-8 xl:gap-16">
          <Image3D
            lightSrc="/feature-1-light.png"
            darkSrc="/feature-1-dark.png"
            alt="TIPS admin workspace preview"
            direction="left"
          />
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                운영팀이 매일 쓰는 화면부터 먼저 재정리
              </h3>
              <p className="text-base text-muted-foreground text-pretty">
                학사일정, 수업 일정, 학생·수업·교재 관리는 모두 같은 카드·필터·배지 언어로 묶고, 이후 상세 로직을 붙이기 쉬운 구조로 맞춥니다.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {mainFeatures.map((feature, index) => (
                <li
                  key={index}
                  className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-accent/5"
                >
                  <div className="mt-0.5 flex shrink-0 items-center justify-center">
                    <feature.icon className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-4 pe-4 pt-2 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/admin/dashboard">
                  관리자 둘러보기
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/classes">공개 수업 보기</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8 xl:gap-16">
          <div className="order-2 space-y-6 lg:order-1">
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                공개 화면과 관리자 화면이 끊기지 않게
              </h3>
              <p className="text-base text-muted-foreground text-pretty">
                `/`, `/classes`, `/reviews`, `/results`는 같은 v2 public shell 안에서 정리하고, 공개 수업 데이터는 라이브 payload를 우선 사용하도록 유지합니다.
              </p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {secondaryFeatures.map((feature, index) => (
                <li
                  key={index}
                  className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-accent/5"
                >
                  <div className="mt-0.5 flex shrink-0 items-center justify-center">
                    <feature.icon className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">{feature.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-4 pe-4 pt-2 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/reviews">
                  후기 보기
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/results">성과 보기</Link>
              </Button>
            </div>
          </div>

          <Image3D
            lightSrc="/feature-2-light.png"
            darkSrc="/feature-2-dark.png"
            alt="TIPS public landing preview"
            direction="right"
            className="order-1 lg:order-2"
          />
        </div>
      </div>
    </section>
  );
}
