import assert from "node:assert/strict"
import test from "node:test"

const formatterModuleUrl = new URL(
  "../src/features/notifications/server/presentation/notification-presentation-formatters.ts",
  import.meta.url,
)

test("KST 날짜는 실행 연도가 아니라 occurred_at의 KST 연도를 기준으로 표시한다", async () => {
  const {
    formatNotificationKstDate,
    formatNotificationKstDateTime,
  } = await import(formatterModuleUrl)
  const occurredAt = "2026-12-31T15:30:00.000Z"

  assert.equal(
    formatNotificationKstDateTime("2027-01-02T00:00:00.000Z", occurredAt),
    "1월 2일(토) 09:00",
  )
  assert.equal(
    formatNotificationKstDate("2026-12-30T15:00:00.000Z", occurredAt),
    "2026년 12월 31일(목)",
  )
})

test("필드 presence는 누락·명시적 null·빈 배열을 서로 다르게 처리한다", async () => {
  const {
    buildOptionalNotificationLine,
    readNotificationFieldPresence,
  } = await import(formatterModuleUrl)
  const displayNull = {
    required: true,
    nullBehavior: "display",
    nullDisplay: "미배정",
    emptyArrayBehavior: "reject",
  }
  const optional = {
    required: false,
    nullBehavior: "omit",
    nullDisplay: null,
    emptyArrayBehavior: "omit",
  }
  const allowEmpty = {
    required: true,
    nullBehavior: "reject",
    nullDisplay: null,
    emptyArrayBehavior: "allow",
  }

  assert.equal(readNotificationFieldPresence({ assignee: null }, "assignee", displayNull), "미배정")
  assert.equal(readNotificationFieldPresence({ memo: null }, "memo", optional), undefined)
  assert.deepEqual(readNotificationFieldPresence({ subjects: [] }, "subjects", allowEmpty), [])
  assert.throws(
    () => readNotificationFieldPresence({}, "assignee", displayNull),
    /notification_presentation_required_field_missing/,
  )
  assert.equal(buildOptionalNotificationLine("메모", undefined), "")
  assert.equal(buildOptionalNotificationLine("메모", "  보호자 요청 확인  "), "[메모] 보호자 요청 확인")
})

test("자유 입력은 연락처·URL·HTML·제어문자를 숨기고 Chat 서식을 중화한다", async () => {
  const { sanitizeNotificationFreeText } = await import(formatterModuleUrl)
  const value = "<b>문의</b>\n010-1234-5678 https://example.com/private *굵게* _밑줄_ ~취소~ `코드`\u0007"

  assert.equal(
    sanitizeNotificationFreeText(value),
    "문의 [연락처 숨김] [링크 포함] ＊굵게＊ ＿밑줄＿ 〜취소〜 ｀코드｀",
  )
})

test("자유 입력 우선순위는 최대 두 필드만 선택하고 각 값을 안전하게 정리한다", async () => {
  const { selectNotificationFreeTextFields } = await import(formatterModuleUrl)
  const selected = selectNotificationFreeTextFields(
    {
      memo: "두 번째 메모",
      reason: "첫 번째 사유",
      comment: "세 번째 댓글",
    },
    ["reason", "memo", "comment"],
  )

  assert.deepEqual(selected, {
    reason: "첫 번째 사유",
    memo: "두 번째 메모",
  })
})

test("240 grapheme 제한은 결합 이모지를 자르지 않고 안전한 원문 길이를 남긴다", async () => {
  const { truncateNotificationGraphemes } = await import(formatterModuleUrl)
  const family = "👨‍👩‍👧‍👦"
  const source = `${"가".repeat(239)}${family}나`

  assert.equal(
    truncateNotificationGraphemes(source, 240),
    `${"가".repeat(239)}${family}… (전체 241자)`,
  )
})

test("사람·팀 표시는 UUID를 이름 fallback으로 쓰지 않고 검증된 팀이나 역할을 사용한다", async () => {
  const { formatNotificationPersonOrTeam } = await import(formatterModuleUrl)
  const uuid = "71000000-0000-4000-8000-000000000001"

  assert.equal(formatNotificationPersonOrTeam({ personName: "김철수" }), "김철수님")
  assert.equal(
    formatNotificationPersonOrTeam({ personName: uuid, teamName: "관리팀", fallback: "담당자" }),
    "관리팀",
  )
  assert.throws(
    () => formatNotificationPersonOrTeam({ personName: uuid }),
    /notification_presentation_person_or_team_missing/,
  )
})

test("본문 정규화는 행 끝 공백과 중복 빈 행만 제거하고 정보 순서를 보존한다", async () => {
  const { normalizeRenderedNotificationBody } = await import(formatterModuleUrl)

  assert.equal(
    normalizeRenderedNotificationBody("\n  [업무] 교재 확인   \n\n\n[진행] 관리팀에서 확인 중이에요.\t\n\n"),
    "  [업무] 교재 확인\n\n[진행] 관리팀에서 확인 중이에요.",
  )
})
