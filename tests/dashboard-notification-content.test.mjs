import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import test from "node:test"

const require = createRequire(import.meta.url)
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const ts = require("typescript")
const componentUrl = new URL("../src/components/dashboard-notification-content.tsx", import.meta.url)
const verifierUrl = new URL("../scripts/verify-notification-content-browser.mjs", import.meta.url)
const taskNode = process.execPath

function notification(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "📥 [등록] 김학생의 등록 문의가 들어왔어요",
    body: "[학생] 김학생 · 중1\n[과목] 수학\n[진행] 관리팀의 확인을 기다리고 있어요.",
    href: "/admin/registration?taskId=10000000-0000-4000-8000-000000000002",
    type: "registration.case_created",
    readAt: "",
    createdAt: "2026-08-04T01:30:00.000Z",
    ...overrides,
  }
}

async function loadComponent() {
  const source = await readFile(componentUrl, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "dashboard-notification-content.tsx",
  }).outputText
  const testModule = { exports: {} }
  const localRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    if (specifier === "next/link") {
      return function TestLink({ href, children, ...props }) {
        return React.createElement("a", { href: String(href), ...props }, children)
      }
    }
    if (specifier === "@/components/ui/button") {
      return {
        Button({ children, variant, size, ...props }) {
          void variant
          void size
          return React.createElement("button", props, children)
        },
      }
    }
    throw new Error(`unexpected dashboard content dependency: ${specifier}`)
  }
  Function("require", "module", "exports", output)(localRequire, testModule, testModule.exports)
  return testModule.exports.DashboardNotificationContent
}

async function render(overrides = {}) {
  const DashboardNotificationContent = await loadComponent()
  return renderToStaticMarkup(React.createElement(DashboardNotificationContent, {
    notification: notification(),
    isRead: false,
    isMarkingRead: false,
    readError: "",
    onOpen: () => {},
    onMarkRead: () => {},
    ...overrides,
  }))
}

test("알림 본문은 줄바꿈과 긴 단어를 보존하고 읽을 수 있는 본문 크기로 렌더한다", async () => {
  const html = await render()

  assert.match(html, /whitespace-pre-wrap/)
  assert.match(html, /overflow-wrap:anywhere/)
  assert.match(html, /text-sm/)
  assert.ok(html.includes("[학생] 김학생 · 중1\n[과목] 수학\n[진행] 관리팀의 확인을 기다리고 있어요."))
  assert.doesNotMatch(html, /\btruncate\b|line-clamp/)
})

test("알려진 상태 이모지만 장식으로 숨기고 맞춤 이모지는 제목 정보로 보존한다", async () => {
  const known = await render()
  const custom = await render({
    notification: notification({ title: "🪄 [맞춤] 원장 확인이 필요해요" }),
  })

  assert.match(known, /<span[^>]+aria-hidden="true"[^>]*>📥<\/span>/)
  assert.match(known, /\[등록\] 김학생의 등록 문의가 들어왔어요/)
  assert.doesNotMatch(custom, /aria-hidden="true"[^>]*>🪄/)
  assert.match(custom, /🪄 \[맞춤\] 원장 확인이 필요해요/)
})

test("읽지 않음·시간·오류·읽음 동작은 색상에 의존하지 않는 DOM 의미를 가진다", async () => {
  const html = await render({ readError: "읽음 처리에 실패했어요." })

  assert.match(html, /role="status"[^>]*>읽지 않음</)
  assert.match(html, /<time[^>]+date[Tt]ime="2026-08-04T01:30:00.000Z"/)
  assert.match(html, /role="alert"[^>]*>읽음 처리에 실패했어요\.<\/div>/)
  assert.match(html, /<button[^>]+min-h-11[^>]+min-w-11[^>]*>읽음<\/button>/)
})

test("링크가 없는 알림도 핵심 사실과 읽음 동작을 그대로 보여준다", async () => {
  const html = await render({ notification: notification({ href: "" }) })

  assert.doesNotMatch(html, /<a\b/)
  for (const fact of ["김학생", "중1", "수학", "관리팀의 확인을 기다리고 있어요."]) {
    assert.ok(html.includes(fact), `링크 없는 알림에 ${fact} 사실이 보여야 한다`)
  }
  assert.match(html, />읽음<\/button>/)
})

test("브라우저 verifier는 명시적인 base URL과 storage state 계약을 안내한다", () => {
  const result = spawnSync(taskNode, [verifierUrl.pathname, "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--base-url/)
  assert.match(result.stdout, /--storage-state/)
  assert.match(result.stdout, /--capture-storage-state/)
  assert.match(result.stdout, /--browser-executable/)
  assert.match(result.stdout, /provider-zero/)
})

test("브라우저 verifier는 알림 버튼이 실제로 보인 뒤에만 인증 상태를 저장한다", async () => {
  const source = await readFile(verifierUrl, "utf8")

  assert.match(source, /getByRole\("button", \{ name: \/\^알림,\/u \}\)\.waitFor/)
})
