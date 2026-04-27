import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const footerLinks = {
  public: [
    { name: "공개 수업", href: "/classes" },
    { name: "후기", href: "/reviews" },
    { name: "성과", href: "/results" },
  ],
  admin: [
    { name: "대시보드", href: "/admin/dashboard" },
    { name: "학생 관리", href: "/admin/students" },
    { name: "교재 관리", href: "/admin/textbooks" },
  ],
  routes: [
    { name: "학사일정", href: "/admin/academic-calendar" },
    { name: "수업 일정", href: "/admin/class-schedule" },
    { name: "시간표", href: "/admin/timetable" },
  ],
};

export function LandingFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(3,1fr)]">
          <div className="space-y-5">
            <Link href="/" className="flex items-center gap-2">
              <Logo size={32} />
              <span className="text-xl font-semibold tracking-tight">TIPS Dashboard</span>
            </Link>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              공개 수업 안내와 운영 워크스페이스를 같은 데이터 흐름 안에서 다시 설계하는 TIPS Dashboard v2입니다. 템플릿은 재사용하되, 실제 운영 문맥은 TIPS 기준으로 다시 정리합니다.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href="/admin/dashboard">
                  관리자 열기
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/classes">공개 수업 보기</Link>
              </Button>
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Public
            </h4>
            <ul className="space-y-3">
              {footerLinks.public.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Admin
            </h4>
            <ul className="space-y-3">
              {footerLinks.admin.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Workspace
            </h4>
            <ul className="space-y-3">
              {footerLinks.routes.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col gap-3 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <p>© {new Date().getFullYear()} TIPS Dashboard v2. Public landing rebuilt for the new route-based v2 experience.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/classes" className="transition-colors hover:text-foreground">
              공개 수업
            </Link>
            <Link href="/reviews" className="transition-colors hover:text-foreground">
              후기
            </Link>
            <Link href="/admin/dashboard" className="transition-colors hover:text-foreground">
              관리자
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
