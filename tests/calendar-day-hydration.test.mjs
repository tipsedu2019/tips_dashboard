import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

const root = new URL("../", import.meta.url)
const renderScript = `
  import React from "react";
  import { renderToStaticMarkup } from "react-dom/server";
  import { loadNotificationComponent } from "./tests/helpers/notification-component-loader.mjs";
  const { CalendarDayButton } = loadNotificationComponent("src/components/ui/calendar.tsx");
  const dates = [new Date(2026, 0, 1, 0, 15), new Date(2026, 11, 31, 23, 45), new Date(2028, 1, 29, 0, 15)];
  console.log(JSON.stringify({
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    days: dates.map(date => {
      const html = renderToStaticMarkup(React.createElement(CalendarDayButton, {
        day: { date }, modifiers: { selected: true }, children: String(date.getDate()),
      }));
      return { key: html.match(/data-day="([^"]+)"/)[1], iso: date.toISOString().slice(0, 10) };
    }),
  }));
`

function renderDays(locale, timezone) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", renderScript], {
    cwd: root,
    env: { ...process.env, LANG: locale, LC_ALL: locale, TZ: timezone },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test("calendar day attributes stay identical across server and browser default locales", () => {
  const server = renderDays("en_US.UTF-8", "Asia/Seoul")
  const client = renderDays("ko_KR.UTF-8", "Asia/Seoul")
  assert.notEqual(server.locale, client.locale, "the two render environments use different defaults")
  assert.deepEqual(server.days.map(day => day.key), client.days.map(day => day.key))
  assert.deepEqual(server.days.map(day => day.key), ["2026-01-01", "2026-12-31", "2028-02-29"])
})

test("calendar day attributes preserve the local date at year and leap-day UTC boundaries", () => {
  const seoul = renderDays("ko_KR.UTF-8", "Asia/Seoul")
  const losAngeles = renderDays("en_US.UTF-8", "America/Los_Angeles")
  assert.equal(seoul.days[0].iso, "2025-12-31", "Korean midnight crosses the previous UTC year")
  assert.equal(losAngeles.days[1].iso, "2027-01-01", "California evening crosses the next UTC year")
  for (const rendered of [seoul, losAngeles]) {
    assert.deepEqual(rendered.days.map(day => day.key), ["2026-01-01", "2026-12-31", "2028-02-29"])
  }
})
