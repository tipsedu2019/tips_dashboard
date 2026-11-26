import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

const { getRoleCapabilities } = loadNotificationComponent("src/lib/auth-utils.ts");

for (const role of ["admin", "staff", "teacher", "viewer"]) {
  for (const path of ["/admin/students", "/admin/classes/item", "/admin/textbooks", "/admin/settings/teachers", "/admin/statistics", "/admin/curriculum", "/admin/textbook-requests", "/admin/registration", "/admin/ai-agent"]) {
    test(`real route guard ${role} ${path}`, () => {
      const { AuthGuard } = loadNotificationComponent("src/components/auth/auth-guard.tsx", new Map([
        ["next/navigation", { useRouter: () => ({ replace() {} }), usePathname: () => path, useSearchParams: () => new URLSearchParams() }],
        ["@/providers/auth-provider", { useAuth: () => ({ user: { id: "actor" }, loading: false, isTeacher: role === "teacher", ...getRoleCapabilities(role) }) }],
      ]));
      const html = renderToStaticMarkup(createElement(AuthGuard, null, createElement("span", null, "protected workspace")));
      const management = ["/admin/students", "/admin/classes/item", "/admin/textbooks", "/admin/settings/teachers", "/admin/statistics"].includes(path);
      assert.equal(html.includes("protected workspace"), !(role === "teacher" && management));
    });
  }
}
