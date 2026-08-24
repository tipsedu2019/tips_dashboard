import { createElement, type ReactNode } from "react"

export const REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME = "ml-1 inline-flex w-8 shrink-0 items-center justify-center overflow-hidden text-xs tabular-nums text-inherit"

function getRegistrationTabCountLabel(count: number) {
  return count > 99 ? "99+" : count
}

export function RegistrationTabCountSlot({ count }: { count: number }): ReactNode {
  return createElement("span", {
    "aria-hidden": true,
    "data-registration-tab-count-slot": "true",
    className: REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME,
  }, count > 0 ? createElement("span", {
    className: "inline-flex max-w-full min-w-5 items-center justify-center truncate rounded bg-background/65 px-1 py-0.5 opacity-80",
  }, getRegistrationTabCountLabel(count)) : null)
}
