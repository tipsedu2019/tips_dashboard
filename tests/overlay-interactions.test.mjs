import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
import { JSDOM } from "jsdom"
import { act, createElement as h, useState } from "react"
import ts from "typescript"

// Radix chooses its layout effect implementation on first import.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  globalThis[key] = key === "window" ? dom.window : dom.window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import("react-dom/client")

const require = createRequire(import.meta.url)
const rootPath = path.resolve(import.meta.dirname, "..")
const cache = new Map()
function load(relativePath) {
  const file = path.join(rootPath, relativePath)
  if (cache.has(file)) return cache.get(file).exports
  const runtime = { exports: {} }
  cache.set(file, runtime)
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const resolve = (specifier) => {
    if (specifier === "@/lib/utils") return load("src/lib/utils.ts")
    if (specifier === "@/components/ui/button") return load("src/components/ui/button.tsx")
    return require(specifier)
  }
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: file })(resolve, runtime, runtime.exports)
  return runtime.exports
}

const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } = load("src/components/ui/dialog.tsx")
const { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } = load("src/components/ui/sheet.tsx")
const { Button } = load("src/components/ui/button.tsx")

async function mount(element) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return async () => {
    await act(async () => root.unmount())
    container.remove()
  }
}

async function click(element) {
  assert.ok(element, "expected an actionable control")
  await act(async () => {
    element.click()
  })
  // FocusScope schedules focus restoration after the close commit.
  await settleFocus()
}

async function settleFocus() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function dialogHeading(title = "학생 정보 수정") {
  return h(DialogHeader, null, h(DialogTitle, null, title), h(DialogDescription, null, "학생 정보를 입력합니다."))
}

test("dialog close uses its accessible name and restores a composed trigger's focus without submitting", async () => {
  let submits = 0
  const cleanup = await mount(h(Dialog, null,
    h(DialogTrigger, { asChild: true }, h(Button, null, "학생 편집")),
    h(DialogContent, { closeButtonLabel: "학생 정보 닫기" },
      dialogHeading(),
      h("form", { onSubmit: (event) => { event.preventDefault(); submits += 1 } }, h("input", { "aria-label": "학생 이름" })),
    ),
  ))
  try {
    const trigger = document.querySelector("button")
    await click(trigger)
    assert.equal(document.activeElement.getAttribute("aria-label"), "학생 이름")
    const close = document.querySelector('[data-slot="dialog-close"]')
    assert.equal(close.getAttribute("aria-label"), "학생 정보 닫기")
    assert.equal(close.type, "button")
    await click(close)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.ok(document.activeElement === trigger, "focus returns to the dialog trigger")
    assert.equal(submits, 0)
  } finally { await cleanup() }
})

test("explicit text close delegates to the form owner and preserves the edited value until it accepts closing", async () => {
  let closeAttempts = 0
  let radixCloseAttempts = 0
  let permitClose = false
  function GuardedForm() {
    const [open, setOpen] = useState(false)
    return h(Dialog, { open, onOpenChange: (next) => { if (!next) radixCloseAttempts += 1; setOpen(next) } },
      h(DialogTrigger, { asChild: true }, h(Button, null, "휴보강 신청")),
      h(DialogContent, {
        closeButtonLabel: "저장하지 않고 닫기", showCloseButtonText: true,
        onCloseButtonClick: () => { closeAttempts += 1; if (permitClose) setOpen(false) },
      }, dialogHeading("긴 수업명과 신청 내용이 있는 휴보강 보완 재상신"), h("input", { "aria-label": "신청 사유", defaultValue: "입력 중인 신청 사유" })),
    )
  }
  const cleanup = await mount(h(GuardedForm))
  try {
    const trigger = document.querySelector("button")
    await click(trigger)
    const close = document.querySelector('[data-slot="dialog-close"]')
    assert.equal(close.textContent, "저장하지 않고 닫기")
    await click(close)
    assert.ok(document.querySelector('[role="dialog"]'))
    assert.equal(document.querySelector("input").value, "입력 중인 신청 사유")
    assert.equal(radixCloseAttempts, 0, "custom close must not bypass the owner's confirmation")
    permitClose = true
    await click(close)
    assert.equal(closeAttempts, 2)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.ok(document.activeElement === trigger, "focus returns to the dialog trigger")
  } finally { await cleanup() }
})

test("dialog close composition can cancel closing and a hidden default close adds no extra action", async () => {
  let childCalls = 0
  let permitClose = false
  const cleanup = await mount(h(Dialog, null,
    h(DialogTrigger, { asChild: true }, h(Button, null, "저장 확인")),
    h(DialogContent, { showCloseButton: false }, dialogHeading(),
      h(DialogClose, { asChild: true }, h(Button, {
        type: "button",
        onClick: (event) => { childCalls += 1; if (!permitClose) event.preventDefault() },
      }, "확인 후 닫기")),
    ),
  ))
  try {
    const trigger = document.querySelector("button")
    await click(trigger)
    const actions = document.querySelectorAll('[role="dialog"] button')
    assert.equal(actions.length, 1)
    await click(actions[0])
    assert.ok(document.querySelector('[role="dialog"]'))
    permitClose = true
    await click(actions[0])
    assert.equal(childCalls, 2)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.ok(document.activeElement === trigger, "focus returns to the dialog trigger")
  } finally { await cleanup() }
})

test("sheet exposes a Korean close action while retaining the owner's close guard and Escape path", async () => {
  let permitClose = false
  let closeAttempts = 0
  function GuardedSheet() {
    const [open, setOpen] = useState(false)
    return h(Sheet, { open, onOpenChange: (next) => { if (!next) closeAttempts += 1; if (next || permitClose) setOpen(next) } },
      h(SheetTrigger, { asChild: true }, h(Button, null, "학사 일정 편집")),
      h(SheetContent, { "data-slot": "sidebar" },
        h(SheetHeader, null, h(SheetTitle, null, "아주 긴 학교 이름을 가진 학사 일정 수정"), h(SheetDescription, null, "일정 내용을 입력합니다.")),
        h("input", { "aria-label": "일정 이름", defaultValue: "작성 중인 일정" }),
      ),
    )
  }
  const cleanup = await mount(h(GuardedSheet))
  try {
    const trigger = document.querySelector("button")
    await click(trigger)
    const close = document.querySelector('[data-slot="sheet-close"]')
    assert.equal(close.getAttribute("aria-label"), "패널 닫기")
    assert.equal(close.type, "button")
    await click(close)
    assert.equal(closeAttempts, 1)
    assert.equal(document.querySelector("input").value, "작성 중인 일정")
    permitClose = true
    await act(async () => {
      document.querySelector("input").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    await settleFocus()
    assert.equal(closeAttempts, 2)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.ok(document.activeElement === trigger, "focus returns to the sheet trigger")
  } finally { await cleanup() }
})

test("nested confirmation closes only its own layer and returns to the parent's draft", async () => {
  const cleanup = await mount(h(Dialog, null,
    h(DialogTrigger, { asChild: true }, h(Button, null, "수업 수정")),
    h(DialogContent, { className: "z-[80]" }, dialogHeading("수업 수정"),
      h("input", { "aria-label": "수업명", defaultValue: "편집 중인 수업" }),
      h(Dialog, null,
        h(DialogTrigger, { asChild: true }, h(Button, null, "변경사항 확인")),
        h(DialogContent, { layer: "nested" }, dialogHeading("저장하지 않은 변경사항"),
          h(DialogClose, { asChild: true }, h(Button, null, "계속 편집"))),
      ),
    ),
  ))
  try {
    await click(document.querySelector("button"))
    const nestedTrigger = [...document.querySelectorAll("button")].find(button => button.textContent === "변경사항 확인")
    await click(nestedTrigger)
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 2)
    await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await settleFocus()
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1)
    assert.equal(document.querySelector('input[aria-label="수업명"]').value, "편집 중인 수업")
    assert.ok(document.activeElement === nestedTrigger)
  } finally { await cleanup() }
})


test("explicit preview overlay and content layers survive common layer composition", async () => {
  const cleanup = await mount(h(Dialog, { defaultOpen: true },
    h(DialogContent, { overlayClassName: "z-[90]", className: "z-[90]" }, dialogHeading("알림 미리보기")),
  ))
  try {
    assert.ok(document.querySelector('[data-slot="dialog-overlay"]').classList.contains("z-[90]"))
    assert.ok(document.querySelector('[role="dialog"]').classList.contains("z-[90]"))
    assert.equal(document.querySelector('[data-slot="dialog-overlay"]').classList.contains("z-50"), false)
  } finally { await cleanup() }
})
