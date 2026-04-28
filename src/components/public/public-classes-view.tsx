"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  MapPin,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import { PublicLayout } from "@/components/public/public-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PublicClassItem = {
  id?: string;
  name?: string;
  className?: string;
  subject?: string;
  grade?: string;
  teacher?: string;
  room?: string;
  classroom?: string;
  schedule?: string;
  capacity?: number;
  studentIds?: string[];
  waitlistIds?: string[];
  fee?: number;
  tuition?: number;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function classTitle(item: PublicClassItem) {
  return clean(item.className || item.name) || "수업명 미정";
}

function formatTuition(item: PublicClassItem) {
  const amount = Number(item.tuition || item.fee || 0);
  return amount > 0 ? `${amount.toLocaleString("ko-KR")}원` : "상담 문의";
}

export function PublicClassesView({
  classes,
  initialSubject = "",
  initialGrade = "",
}: {
  classes: PublicClassItem[];
  initialSubject?: string;
  initialGrade?: string;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [grade, setGrade] = useState(initialGrade);

  const subjects = useMemo(
    () => unique(classes.map((item) => item.subject || "")),
    [classes],
  );
  const grades = useMemo(
    () => unique(classes.map((item) => item.grade || "")),
    [classes],
  );

  const filteredClasses = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return classes.filter((item) => {
      const subjectMatched = !subject || clean(item.subject) === subject;
      const gradeMatched = !grade || clean(item.grade) === grade;
      const searchable = [
        classTitle(item),
        item.subject,
        item.grade,
        item.teacher,
        item.classroom,
        item.room,
        item.schedule,
      ]
        .map(clean)
        .join(" ")
        .toLowerCase();

      return subjectMatched && gradeMatched && (!keyword || searchable.includes(keyword));
    });
  }, [classes, grade, query, subject]);

  return (
    <PublicLayout
      eyebrow="PUBLIC CLASSES"
      title="공개 수업"
      description="과목을 먼저 고르고 학년과 시간표를 바로 확인합니다."
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="수업명, 선생님, 강의실"
            className="h-11 pl-9"
          />
        </div>
        <Button asChild>
          <Link href="/inquiry">상담 문의</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={subject ? "outline" : "default"}
          onClick={() => setSubject("")}
        >
          전체 과목
        </Button>
        {subjects.map((item) => (
          <Button
            key={item}
            type="button"
            variant={subject === item ? "default" : "outline"}
            onClick={() => setSubject(item)}
          >
            {item}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={grade ? "outline" : "secondary"}
          onClick={() => setGrade("")}
        >
          전체 학년
        </Button>
        {grades.map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={grade === item ? "secondary" : "outline"}
            onClick={() => setGrade(item)}
          >
            {item}
          </Button>
        ))}
      </div>

      {filteredClasses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          조건에 맞는 수업이 없습니다.
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredClasses.map((item, index) => {
            const enrolled = Array.isArray(item.studentIds) ? item.studentIds.length : 0;
            const capacity = Number(item.capacity || 0);

            return (
              <article
                key={item.id || `${classTitle(item)}-${index}`}
                className="grid gap-5 rounded-lg border bg-card p-5 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.subject ? <Badge>{item.subject}</Badge> : null}
                    {item.grade ? <Badge variant="secondary">{item.grade}</Badge> : null}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {classTitle(item)}
                    </h2>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="size-4" />
                        {clean(item.schedule) || "시간 협의"}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <UserRound className="size-4" />
                        {clean(item.teacher) || "선생님 미정"}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="size-4" />
                        {clean(item.classroom || item.room) || "강의실 미정"}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <UsersRound className="size-4" />
                        {capacity > 0 ? `${enrolled}/${capacity}명` : "정원 문의"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 md:flex-col md:items-end">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">수강료</p>
                    <p className="text-lg font-semibold">{formatTuition(item)}</p>
                  </div>
                  <Button asChild variant="outline">
                    <Link href={`/inquiry?classId=${encodeURIComponent(item.id || "")}`}>
                      <BookOpen className="size-4" />
                      문의
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PublicLayout>
  );
}
