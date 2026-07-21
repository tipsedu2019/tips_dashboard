"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type WordRetestManualDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const WORD_RETEST_MANUAL_FLOWS = [
  {
    label: "기본 재시험",
    flow: "재시험(기본) 추가 → 시험 시작 → 점수 입력·저장 → 결과 판정",
  },
  {
    label: "기본 미응시",
    flow: "본시험일 + 7일 → 미응시 보고 → 미응시 확인 또는 재재시험 추가",
  },
  {
    label: "불합격",
    flow: "불합격 보고 → 불합격 확인 또는 재재시험 추가",
  },
  {
    label: "합격",
    flow: "합격 보고 → 합격 확인",
  },
] as const

export function WordRetestManualDialog({ open, onOpenChange }: WordRetestManualDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeButtonLabel="영어 단어 재시험 업무 매뉴얼 닫기"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>영어 단어 재시험 업무 매뉴얼</DialogTitle>
          <DialogDescription>업무 흐름과 재재시험 기준을 확인하세요.</DialogDescription>
        </DialogHeader>

        <ol aria-label="영어 단어 재시험 업무 흐름" className="grid gap-2">
          {WORD_RETEST_MANUAL_FLOWS.map((item) => (
            <li key={item.label} className="rounded-md border px-3 py-2.5">
              <h3 className="text-sm font-semibold">{item.label}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.flow}</p>
            </li>
          ))}
        </ol>

        <section aria-labelledby="word-retest-reretry-manual-title" className="rounded-md border bg-muted/35 px-3 py-2.5">
          <h3 id="word-retest-reretry-manual-title" className="text-sm font-semibold">재재시험</h3>
          <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm leading-6 text-muted-foreground">
            <li>이전 본시험일 기본 유지</li>
            <li>자동 미응시 기한 없음</li>
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  )
}
