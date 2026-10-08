"use client"

import { useEffect, useSyncExternalStore } from "react"

const recoveryAttempt = String(Date.now())
const subscribe = () => () => {}
const serverHref = () => ""
function browserHref() {
  const url = new URL(window.location.href)
  url.searchParams.set("_tips_recovery", recoveryAttempt)
  return url.href
}

// Keep this fallback independent of providers, icons and shared UI chunks.
// It must remain readable when the layout or its stylesheet cannot load.
export function PageRecovery() {
  // A real href also supports keyboard, middle-click and the context menu.
  const href = useSyncExternalStore(subscribe, browserHref, serverHref)
  useEffect(() => { document.getElementById("tips-script-recovery")?.remove() }, [])
  return (
    <main data-page-recovery style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24,
      boxSizing: "border-box", background: "var(--background, #fff)", color: "var(--foreground, #171717)",
      fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: 24, lineHeight: 1.4 }}>화면을 불러오지 못했습니다</h1>
        <p style={{ lineHeight: 1.7 }}>현재 탭은 그대로 두고 새 탭에서 다시 열어 주세요. 저장 여부를 확인한 뒤 작업을 이어가세요.</p>
        <a href={href} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", minHeight: 44,
            color: "inherit", textUnderlineOffset: 4 }}>
          새 탭에서 다시 열기
        </a>
      </div>
    </main>
  )
}
