"use client"

import type { RegistrationAdmissionChecklistItem, RegistrationAdmissionChecklistState } from "./registration-track-service"

export const REGISTRATION_ADMISSION_CHECKLIST_ITEMS: ReadonlyArray<{
  key: RegistrationAdmissionChecklistItem
  label: string
}> = [
  { key: "applicationSent", label: "입학신청서 발송" },
  { key: "makeeduRegistered", label: "메이크에듀 등록(수업, 교재)" },
  { key: "invoiceSent", label: "청구서 발송" },
  { key: "paymentConfirmed", label: "수납 완료 확인" },
  { key: "registrationCompleted", label: "등록 완료" },
]

export function RegistrationAdmissionChecklist({
  checklist,
  editable,
  savingItems,
  onCheckedChange,
}: {
  checklist: RegistrationAdmissionChecklistState
  editable: boolean
  savingItems: ReadonlySet<RegistrationAdmissionChecklistItem>
  onCheckedChange: (item: RegistrationAdmissionChecklistItem, checked: boolean) => void
}) {
  return (
    <ul aria-label="입학 처리 체크리스트" className="divide-y rounded-md border bg-background">
      {REGISTRATION_ADMISSION_CHECKLIST_ITEMS.map((item) => (
        <li key={item.key} className="min-w-0">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={checklist[item.key]}
              disabled={!editable || savingItems.has(item.key)}
              onChange={(event) => onCheckedChange(item.key, event.target.checked)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words">{item.label}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}
