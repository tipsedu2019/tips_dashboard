import Link from "next/link";
import { ArrowRight, BookOpen, MessageSquareQuote, Trophy } from "lucide-react";

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
            <Link
              href="/classes"
              className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              공개 수업
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/admin/dashboard"
              className="inline-flex h-12 items-center rounded-md border px-5 text-sm font-semibold transition hover:bg-accent"
            >
              관리자
            </Link>
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
              className="group flex min-h-32 items-end justify-between rounded-lg border bg-card p-5 transition hover:border-primary/60 hover:bg-accent/30"
            >
              <div>
                <item.icon className="mb-5 size-5 text-primary" />
                <p className="text-lg font-semibold">{item.label}</p>
                <p className="text-sm text-muted-foreground">{item.value}</p>
              </div>
              <ArrowRight className="size-4 opacity-0 transition group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
