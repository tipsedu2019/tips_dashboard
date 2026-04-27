import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const redirectedAdminRoutes = [
  "v2/src/app/admin/dashboard-2/page.tsx",
  "v2/src/app/admin/pricing/page.tsx",
  "v2/src/app/admin/faqs/page.tsx",
  "v2/src/app/admin/chat/page.tsx",
  "v2/src/app/admin/mail/page.tsx",
  "v2/src/app/admin/tasks/page.tsx",
  "v2/src/app/admin/users/page.tsx",
  "v2/src/app/admin/settings/account/page.tsx",
  "v2/src/app/admin/settings/appearance/page.tsx",
  "v2/src/app/admin/settings/billing/page.tsx",
  "v2/src/app/admin/settings/connections/page.tsx",
  "v2/src/app/admin/settings/notifications/page.tsx",
  "v2/src/app/admin/settings/user/page.tsx",
]

test("non-core admin routes stay consolidated behind dashboard redirects", () => {
  for (const relativePath of redirectedAdminRoutes) {
    const source = read(relativePath)
    assert.match(source, /import \{ redirect \} from "next\/navigation";/)
    assert.match(source, /redirect\("\/admin\/dashboard"\);/)
  }
})

test("calendar alias continues redirecting into the core academic calendar workspace", () => {
  const source = read("v2/src/app/admin/calendar/page.tsx")
  assert.match(source, /redirect\("\/admin\/academic-calendar"\);/)
})

test("manual page documents that non-core admin routes remain intentionally minimized", () => {
  const source = read("v2/src/app/admin/manual/page.tsx")

  assert.match(source, /비핵심 admin 축소 유지/)
  assert.match(source, /dashboard-2, pricing, faqs, chat, mail, tasks, users/)
  assert.match(source, /settings 보조 라우트도 운영 핵심 범위 밖으로 유지합니다/)
})
