import assert from "node:assert/strict"
import test from "node:test"
import { JSDOM } from "jsdom"
import * as React from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

async function setup(t, { mobile = true, defaultOpen = true, menuTooltip = false, realNavigation = false } = {}) {
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
  const sidebarModule = loadNotificationComponent(
    "src/components/ui/sidebar.tsx",
    new Map([["@/hooks/use-mobile", { useIsMobile: () => mobile }]]),
  )
  const { Sidebar, SidebarProvider, SidebarTrigger, SidebarMenuButton, useSidebar } = sidebarModule
  const h = React.createElement
  let navigate = () => {}
  const { NavMain } = loadNotificationComponent("src/components/nav-main.tsx", new Map([
    ["@/components/ui/sidebar", sidebarModule],
    ["next/navigation", {useRouter: () => ({prefetch() {}}), usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search)}],
    ["next/link", {__esModule: true, default: React.forwardRef(function Link({href, children, onClick, ...props}, ref) {return h("a", {...props, ref, href, onClick(event) {onClick?.(event); if (!event.defaultPrevented) {event.preventDefault(); navigate(href)} }}, children)})}],
  ]))
  function Content() {
    const { setOpenMobile } = useSidebar()
    const [route, setRoute] = React.useState("original")
    navigate = href => { window.history.pushState({}, "", href); setRoute("next") }
    React.useEffect(() => { if (route === "next" && !realNavigation) document.querySelector("h1")?.focus() }, [route])
    return h(React.Fragment, null,
      h(Sidebar, null,
        realNavigation ? h(NavMain, {label: "메뉴", items:[{title:"다른 화면", url:"/admin/next"}]}) : h(menuTooltip ? SidebarMenuButton : React.Fragment, menuTooltip ? { asChild: true, tooltip: "다른 화면 이동" } : null, h("a", { href: "/admin/next", onClick: event => {
          event.preventDefault()
          window.history.pushState({}, "", "/admin/next")
          setRoute("next")
          setOpenMobile(false)
        } }, "다른 화면 이동"))),
      h(SidebarTrigger),
      h("input", { "aria-label": "검색" }),
      h("h1", { id: "admin-workspace", tabIndex: -1 }, route === "next" ? "새 화면" : "현재 화면"))
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

test("custom sidebar hotkeys leave the focused input and menu unchanged", async t => {
  const p = await setup(t)
  const input = document.querySelector('input[aria-label="검색"]')
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const event = new window.KeyboardEvent("keydown", { key: "b", [modifier]: true, bubbles: true, cancelable: true })
    await React.act(async () => { input.focus(); window.dispatchEvent(event) })
    await p.settle()
    assert.equal(event.defaultPrevented, false)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.ok(document.activeElement === input)
  }
  await p.open()
  await p.escape()
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

test("real NavMain route selection closes the mobile sheet without a fake Link close callback", async t => {
  const p = await setup(t, {realNavigation:true});
  await p.open();
  await React.act(async () => document.querySelector('[role="dialog"] a').click());
  await p.settle();
  assert.equal(window.location.pathname, "/admin/next");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, document.querySelector('h1'));
});
