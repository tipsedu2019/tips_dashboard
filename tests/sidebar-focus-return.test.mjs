import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

async function setup(t, { mobile = true, defaultOpen = true, menuTooltip = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/word-retests" })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  for (const key of ["HTMLElement", "Element", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "HTMLInputElement", "KeyboardEvent"])
    globalThis[key] = dom.window[key]
  globalThis.getComputedStyle = window.getComputedStyle
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout
  // JSDOM has no layout; model visible rectangles for focus restoration checks.
  window.HTMLElement.prototype.getClientRects = function () {
    return this.hidden || this.style.display === "none" ? [] : [{ width: 32, height: 32 }]
  }
  const { createRoot } = await import("react-dom/client")
  const { Sidebar, SidebarProvider, SidebarTrigger, SidebarMenuButton, useSidebar } = loadNotificationComponent(
    "src/components/ui/sidebar.tsx",
    new Map([["@/hooks/use-mobile", { useIsMobile: () => mobile }]]),
  )
  const h = React.createElement
  function Content() {
    const { setOpenMobile } = useSidebar()
    const [route, setRoute] = React.useState("original")
    React.useEffect(() => { if (route === "next") document.querySelector("h1")?.focus() }, [route])
    return h(React.Fragment, null,
      h(Sidebar, null,
        h(menuTooltip ? SidebarMenuButton : React.Fragment, menuTooltip ? { asChild: true, tooltip: "다른 화면 이동" } : null, h("a", { href: "/admin/next", onClick: event => {
          event.preventDefault()
          window.history.pushState({}, "", "/admin/next")
          setRoute("next")
          setOpenMobile(false)
        } }, "다른 화면 이동"))),
      h(SidebarTrigger),
      h("input", { "aria-label": "검색" }),
      h("h1", { tabIndex: -1 }, route === "next" ? "새 화면" : "현재 화면"))
  }
  const root = createRoot(document.getElementById("root"))
  await React.act(async () => root.render(h(SidebarProvider, { defaultOpen }, h(Content))))
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close() })
  const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  const open = async () => {
    const trigger = document.querySelector('[data-sidebar="trigger"]')
    await React.act(async () => { trigger.focus(); trigger.click() })
    await settle()
    assert.ok(document.querySelector('[role="dialog"]')?.contains(document.activeElement))
    return trigger
  }
  const escape = async () => {
    await React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    await settle()
    assert.equal(document.querySelector('[role="dialog"]'), null)
  }
  return { open, escape, settle }
}

test("mobile sidebar Escape returns focus to the actual opening button", async t => {
  const p = await setup(t)
  const trigger = await p.open()
  await p.escape()
  assert.ok(document.activeElement === trigger, "focus returns to opening button")
})

test("mobile sidebar opened by shortcut returns focus to the prior input", async t => {
  const p = await setup(t)
  const input = document.querySelector('input[aria-label="검색"]')
  await React.act(async () => {
    input.focus()
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await p.settle()
  await p.escape()
  assert.ok(document.activeElement === input, "focus returns to shortcut input")
})

test("mobile sidebar navigation preserves the new route heading focus", async t => {
  const p = await setup(t)
  await p.open()
  await React.act(async () => document.querySelector('[role="dialog"] a').click())
  await p.settle()
  assert.equal(window.location.pathname, "/admin/next")
  assert.ok(document.activeElement === document.querySelector("h1"), "new route keeps focus")
})

for (const unavailable of ["disabled", "hidden", "detached"]) {
  test(`mobile sidebar does not try to focus a ${unavailable} opener`, async t => {
    const p = await setup(t)
    const trigger = await p.open()
    let attempts = 0
    trigger.focus = () => { attempts++ }
    if (unavailable === "disabled") trigger.disabled = true
    else if (unavailable === "hidden") trigger.hidden = true
    else trigger.remove()
    await p.escape()
    assert.equal(attempts, 0)
  })
}


test("mobile sidebar focused menu tooltip never consumes the first Escape", async t => {
  const p = await setup(t, { menuTooltip: true });
  const trigger = await p.open();
  const link = document.querySelector('[role="dialog"] a');
  await React.act(async () => { link.blur(); link.focus(); });
  await p.settle();
  assert.notEqual(link.getAttribute("data-state"), "instant-open", "the hidden tooltip must stay closed");
  assert.equal(link.hasAttribute("aria-describedby"), false);
  await p.escape();
  assert.ok(document.activeElement === trigger);
});

for (const collapsed of [false, true]) test(`desktop ${collapsed ? "collapsed" : "expanded"} menu tooltip focus and hover preserve visible-label behavior`, async t => {
  const p = await setup(t, { mobile: false, defaultOpen: !collapsed, menuTooltip: true });
  const link = document.querySelector('a');
  await React.act(async () => link.focus());
  await p.settle();
  assert.equal(Boolean(document.querySelector('[role="tooltip"]')), collapsed, "only the collapsed menu shows focus tooltip");
  await React.act(async () => link.blur());
  await p.settle();
  await React.act(async () => {
    const pointer = new window.Event("pointermove", { bubbles: true });
    Object.assign(pointer, { pointerType: "mouse", clientX: 15, clientY: 15 });
    link.dispatchEvent(pointer);
  });
  await p.settle();
  assert.equal(Boolean(document.querySelector('[role="tooltip"]')), collapsed, "only the collapsed menu shows hover tooltip");
  if (collapsed) {
    await React.act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await p.settle();
    assert.equal(document.querySelector('[role="tooltip"]'), null);
  }
});

test("desktop menu expansion clears tooltip state without changing its control mode", async t => {
  const p = await setup(t, { mobile: false, defaultOpen: false, menuTooltip: true });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const link = document.querySelector("a"), trigger = document.querySelector('[data-sidebar="trigger"]');
    await React.act(async () => link.focus());
    await p.settle();
    assert.ok(document.querySelector('[role="tooltip"]'));
    await React.act(async () => trigger.click());
    await p.settle();
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    await React.act(async () => { link.blur(); trigger.focus(); trigger.click(); });
    await p.settle();
    assert.equal(document.querySelector('[role="tooltip"]'), null, "collapse does not reopen a stale tooltip");
    await React.act(async () => link.focus());
    await p.settle();
    assert.ok(document.querySelector('[role="tooltip"]'));
    assert.deepEqual(warnings, []);
  } finally { console.warn = warn; }
});
