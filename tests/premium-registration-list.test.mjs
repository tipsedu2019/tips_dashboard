import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

const { RegistrationCaseList } = loadNotificationComponent("src/features/tasks/registration-case-list.tsx")
const { buildRegistrationCaseListItems, filterRegistrationCaseListItems } = loadNotificationComponent("src/features/tasks/registration-case-list-model.ts")
function fixture(subjects = ["영어", "수학", "과학"]) {
  return filterRegistrationCaseListItems(buildRegistrationCaseListItems([{
    id: "case-3", studentName: "긴이름학생", registration: { schoolName: "긴학교이름중학교", schoolGrade: "중2" },
    registrationTracks: subjects.map((subject, index) => ({
      id: `track-${index}`, taskId: "case-3", subject, status: "consultation_waiting",
      workflowStatus: "consultation_requested",
      directorName: ["영어 담당자", "수학 담당자 이름이 긴 경우", "과학 담당자"][index],
      directorProfileId: `teacher-${index}`, phoneReadyAt: index === 0 ? "2026-09-15T03:00:00Z" : null,
      visitScheduledAt: index === 1 ? "2026-09-16T03:00:00Z" : "", visitPlace: index === 1 ? "본관의 긴 상담 장소" : "",
      stageEnteredAt: "2026-09-15T00:00:00Z", workflowStatusEnteredAt: "2026-09-15T00:00:00Z",
    })),
  }]), "consultation_requested")
}
const noop = () => {}
const props = { viewerRole: "admin", onOpen: noop, onEdit: noop, onStatusChange: noop, canDelete: () => false, onDelete: noop }

test("three subject columns share subgrid rows and retain missing time placeholders", () => {
  const items = fixture()
  assert.equal(items[0].matchingTracks.length, 3)
  const html = renderToStaticMarkup(createElement(RegistrationCaseList, { ...props, items }))
  const doc = new JSDOM(html).window.document
  const desktop = doc.querySelector('[data-testid="registration-case-desktop-list"]')
  const row = desktop.querySelector('[data-registration-case-row]')
  assert.equal(row.style.gridTemplateRows, "repeat(3, minmax(2rem, auto))")
  const cells = [...row.querySelectorAll('[role="cell"]')]
  assert.equal(cells.length, 5)
  for (const cell of cells) {
    assert.equal(cell.style.gridRow, "span 3")
    assert.ok(cell.classList.contains("grid-rows-subgrid"))
  }
  for (const cell of cells.slice(1)) {
    assert.deepEqual([...cell.querySelectorAll('[data-registration-track-line]')].map((line) => line.dataset.registrationTrackLine), ["track-0", "track-1", "track-2"])
  }
  const owners = [...cells[3].querySelectorAll('[data-registration-track-line]')]
  assert.match(owners[1].textContent, /수학 담당자 이름이 긴 경우/)
  const times = [...cells[4].querySelectorAll('[data-registration-track-line]')]
  assert.match(times[0].textContent, /전화상담/)
  assert.match(times[1].textContent, /본관의 긴 상담 장소/)
  assert.match(times[2].textContent, /미정/)
  assert.equal(row.querySelectorAll('[data-registration-subject-anchor]').length, 3)
  assert.equal(row.querySelectorAll('.lg\\:sr-only').length, 9)
  assert.equal(doc.querySelector('[data-testid="registration-case-mobile-list"]').querySelectorAll('[data-registration-track-line]').length, 12)
})

test("single subject keeps one anchor and school identity uses plain text", () => {
  const doc = new JSDOM(renderToStaticMarkup(createElement(RegistrationCaseList, { ...props, items: fixture(["영어"]) }))).window.document
  const row = doc.querySelector('[data-testid="registration-case-desktop-list"] [data-registration-case-row]')
  assert.equal(row.querySelectorAll('[data-registration-subject-anchor]').length, 1)
  assert.equal([...row.querySelectorAll('span')].filter((span) => span.textContent === "영어").length, 1)
  const school = [...row.querySelectorAll('span')].find((span) => span.textContent === "긴학교이름중학교")
  assert.ok(school)
  assert.doesNotMatch(school.className, /border|rounded/)
})
