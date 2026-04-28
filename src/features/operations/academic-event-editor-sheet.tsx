"use client";

import { CalendarDays, Lock, PencilLine, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type AcademicEventDraft = {
  id?: string;
  title?: string;
  schoolId?: string;
  type?: string;
  start?: string;
  end?: string;
  grade?: string;
  note?: string;
};

type AcademicEventSchoolOption = {
  id: string;
  name: string;
  category?: string;
};

type AcademicEventEditorSheetProps = {
  open: boolean;
  readOnly: boolean;
  saving: boolean;
  error: string | null;
  draft: AcademicEventDraft | null;
  schoolOptions: AcademicEventSchoolOption[];
  typeOptions: string[];
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<AcademicEventDraft>) => void;
  onSubmit: () => void;
  onDelete: () => void;
};

export function AcademicEventEditorSheet({
  open,
  readOnly,
  saving,
  error,
  draft,
  schoolOptions,
  typeOptions,
  onOpenChange,
  onDraftChange,
  onSubmit,
  onDelete,
}: AcademicEventEditorSheetProps) {
  const isEditing = Boolean(draft?.id);
  const isDisabled = readOnly || saving;
  const selectedSchool =
    schoolOptions.find((school) => school.id === draft?.schoolId) || null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="w-fit">
              {isEditing ? (
                <PencilLine className="mr-2 size-3.5" />
              ) : (
                <Plus className="mr-2 size-3.5" />
              )}
              {readOnly ? "읽기 전용" : isEditing ? "일정 수정" : "일정 추가"}
            </Badge>
            {selectedSchool ? (
              <Badge variant="secondary">{selectedSchool.name}</Badge>
            ) : null}
          </div>
          <SheetTitle>
            {readOnly
              ? "학사 일정 상세"
              : isEditing
                ? "학사 일정 수정"
                : "새 학사 일정 추가"}
          </SheetTitle>
          <SheetDescription>
            {readOnly
              ? "현재 등록된 일정 내용을 확인할 수 있습니다."
              : "학교, 일정 유형, 기간, 메모 정보를 같은 시트에서 편집합니다."}
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {!readOnly && schoolOptions.length === 0 ? (
              <Alert>
                <AlertDescription>
                  연결된 학교 데이터가 없어 현재는 새 일정을 저장할 수 없습니다.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="academic-event-title">일정 제목</Label>
                <Input
                  id="academic-event-title"
                  value={draft?.title || ""}
                  disabled={isDisabled}
                  placeholder="예: 고1 중간고사, 입시설명회"
                  onChange={(event) => onDraftChange({ title: event.target.value })}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="academic-event-school">학교</Label>
                  <Select
                    value={draft?.schoolId || ""}
                    disabled={isDisabled || schoolOptions.length === 0}
                    onValueChange={(value) => onDraftChange({ schoolId: value })}
                  >
                    <SelectTrigger id="academic-event-school" className="w-full">
                      <SelectValue placeholder="학교 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {schoolOptions.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="academic-event-type">유형</Label>
                  <Select
                    value={draft?.type || ""}
                    disabled={isDisabled}
                    onValueChange={(value) => onDraftChange({ type: value })}
                  >
                    <SelectTrigger id="academic-event-type" className="w-full">
                      <SelectValue placeholder="유형 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="academic-event-start">시작일</Label>
                  <Input
                    id="academic-event-start"
                    type="date"
                    value={draft?.start || ""}
                    disabled={isDisabled}
                    onChange={(event) => onDraftChange({ start: event.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="academic-event-end">종료일</Label>
                  <Input
                    id="academic-event-end"
                    type="date"
                    value={draft?.end || ""}
                    disabled={isDisabled}
                    onChange={(event) => onDraftChange({ end: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="academic-event-grade">대상 학년</Label>
                <Input
                  id="academic-event-grade"
                  value={draft?.grade || ""}
                  disabled={isDisabled}
                  placeholder="예: 고1, 중3, all"
                  onChange={(event) => onDraftChange({ grade: event.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="academic-event-note">메모</Label>
                <Textarea
                  id="academic-event-note"
                  rows={6}
                  value={draft?.note || ""}
                  disabled={isDisabled}
                  placeholder="운영 메모, 범위, 준비물, 공지 항목"
                  onChange={(event) => onDraftChange({ note: event.target.value })}
                />
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                {readOnly ? (
                  <Lock className="size-4 text-muted-foreground" />
                ) : (
                  <CalendarDays className="size-4 text-primary" />
                )}
                일정 요약
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p>{draft?.title || "제목이 아직 없습니다."}</p>
                <p>{selectedSchool?.name || "학교를 아직 선택하지 않았습니다."}</p>
                <p>
                  {draft?.start || "시작일 미정"}
                  {draft?.end ? ` ~ ${draft.end}` : ""}
                </p>
                <p>{draft?.type || "유형 미정"}</p>
              </div>
            </div>
          </div>

          <SheetFooter className="border-t sm:flex-row sm:items-center sm:justify-between">
            <div>
              {!readOnly && isEditing ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={onDelete}
                  disabled={saving}
                >
                  <Trash2 className="size-4" />
                  삭제
                </Button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                닫기
              </Button>
              {!readOnly ? (
                <Button type="submit" disabled={saving || schoolOptions.length === 0}>
                  {saving ? "저장 중..." : isEditing ? "변경 저장" : "일정 추가"}
                </Button>
              ) : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
