import assert from "node:assert/strict"
import test from "node:test"
import { parseStatisticsRouteState as parse, serializeStatisticsRouteState as serialize } from "../src/features/dashboard/statistics-route-state.ts"

test("student link roundtrips and default/invalid/duplicate values canonicalize", () => {
  const query = "tab=students_classes&subject=english&division=high"
  assert.equal(serialize(parse(query)), query)
  assert.deepEqual(parse(query), { tab: "students_classes", subject: "english", division: "high", range: 90 })
  assert.equal(serialize(parse("tab=bad&subject=english&division=high&range=365&unknown=value")), "")
  assert.equal(serialize(parse("tab=students_classes&subject=bad&division=all&range=30")), "tab=students_classes")
  assert.equal(serialize(parse("tab=students_classes&subject=english&subject=math")), "tab=students_classes")
  assert.equal(serialize(parse("tab=overview")), "")
})

test("each range tab keeps only its existing presets and drops student filters", () => {
  for (const [tab, presets] of [["schedule_conflicts", [90, 180, 400]], ["textbooks", [30, 90, 180, 365]]]) {
    for (const range of presets) {
      const state = parse(`tab=${tab}&range=${range}&subject=english&division=high`)
      assert.equal(state.range, range)
      assert.equal(state.subject, "all")
      assert.equal(state.division, "all")
      assert.equal(serialize(state), `tab=${tab}${range === 90 ? "" : `&range=${range}`}`)
    }
  }
  assert.equal(parse("tab=schedule_conflicts&range=365").range, 90)
  assert.equal(parse("tab=textbooks&range=400").range, 90)
})
