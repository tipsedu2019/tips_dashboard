import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

const paths = ["/admin/word-retests", "/admin/word-retests/existing", "/admin/word-retests-other", "/admin/tasks", "/admin/academic-calendar", "/admin/academic-calendar/annual-board", "/admin/calendar", "/admin/timetable", "/admin/ai-agent", "/admin/registration", "/admin/transfer", "/admin/withdrawal", "/admin/makeup-requests", "/admin/curriculum", "/admin/textbook-requests", "/admin/students", "/admin/settings/account"];
for (const path of paths) test(`assistant actual AuthGuard ${path}`, () => {
  const { AuthGuard } = loadNotificationComponent("src/components/auth/auth-guard.tsx", new Map([
    ["next/navigation", { useRouter: () => ({ replace() {} }), usePathname: () => path, useSearchParams: () => new URLSearchParams() }],
    ["@/providers/auth-provider", { useAuth: () => ({ user: { id: "synthetic-assistant" }, loading: false, isTeacher: false, canAccessDashboard: true, canUseAssistantOperations: true, defaultAdminPath: "/admin/word-retests" }) }],
  ]));
  const html = renderToStaticMarkup(createElement(AuthGuard, null, createElement("span", null, "protected work")));
  assert.equal(html.includes("protected work"), path === "/admin/word-retests" || path.startsWith("/admin/word-retests/"));
});
