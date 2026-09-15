import assert from "node:assert/strict"
import test from "node:test"
import { sortStatisticsDistribution, statisticsBarPercent } from "../src/features/dashboard/statistics-presentation.ts"

test("education order, count ties, stable server keys and all 50 long labels survive presentation", () => {
  const grades = ["고3", "중2", "초6", "미지정", "고1", "초1", "중1"].map((label, i) => ({ key: `key-${i}`, label, studentCount: i }))
  assert.deepEqual(sortStatisticsDistribution(grades, "grade").map(row => row.label), ["초1", "초6", "중1", "중2", "고1", "고3", "미지정"])
  const rows = Array.from({ length: 50 }, (_, i) => ({ key: `school-${i}`, label: `${i % 2 ? "나" : "가"}학교${i}매우긴학교이름반복반복반복`, studentCount: i % 3 }))
  const sorted = sortStatisticsDistribution(rows, "school")
  assert.equal(sorted.length, 50)
  assert.equal(sorted[0].studentCount, 2)
  assert.ok(sorted[0].label.startsWith("가"))
  assert.deepEqual(new Set(sorted.map(row => row.key)), new Set(rows.map(row => row.key)))
  assert.equal(rows[0].key, "school-0")
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].studentCount >= sorted[i].studentCount)
})

test("zero baseline ratios stay finite with empty, zero, invalid and mixed counts", () => {
  assert.equal(statisticsBarPercent(0, 0), 0)
  assert.equal(statisticsBarPercent(10, 0), 0)
  assert.equal(statisticsBarPercent(NaN, 5), 0)
  assert.equal(statisticsBarPercent(-1, 5), 0)
  assert.equal(statisticsBarPercent(5, 10), 50)
  assert.equal(statisticsBarPercent(10, 10), 100)
})
