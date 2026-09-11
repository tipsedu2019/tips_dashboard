import Link from "next/link";
import { ArrowRight, BookOpen, MessageSquareQuote, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto grid min-h-screen max-w-7xl content-center gap-10 px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
            TIPS
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
            제주 영어·수학 수업을 빠르게 찾고 바로 상담합니다.
          </h1>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-5">
              <Link href="/classes">
                공개 수업
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-5">
              <Link href="/admin/dashboard">관리자</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { href: "/classes", label: "수업", value: "과목·학년·시간", icon: BookOpen },
            { href: "/reviews", label: "후기", value: "학생·학부모", icon: MessageSquareQuote },
            { href: "/results", label: "성과", value: "내신·모의고사", icon: Trophy },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-h-32 items-end justify-between rounded-lg border bg-card p-5 outline-none transition-[background-color,border-color,box-shadow] duration-[var(--motion-duration-control)] ease-[var(--motion-easing-control)] hover:border-primary/60 hover:bg-accent/30 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] motion-reduce:transition-none"
            >
              <div>
                <item.icon className="mb-5 size-5 text-primary" aria-hidden="true" />
                <p className="text-lg font-semibold">{item.label}</p>
                <p className="text-sm text-muted-foreground">{item.value}</p>
              </div>
              <ArrowRight className="size-4 opacity-0 transition-opacity duration-[var(--motion-duration-control)] group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
