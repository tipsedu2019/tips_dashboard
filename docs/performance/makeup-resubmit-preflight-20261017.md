# 휴보강 보완 재상신 사전 조회 축소 — 2026-10-17

보완 재상신 한 건에 전체 workspace를 불러온 뒤 단건을 다시 읽어, 목록이 비어 있지 않으면 사전 읽기9회가 발생했다. 같은 UI 호출에서 기존 최신4종 form context와 get_makeup_detail_v1을 사용해5회로 줄였다. 다른 처리·승인·환불·삭제 경로는 바꾸지 않는다.

재상신은 교사·결재자를 바꿀 수 있으므로 receipt 결과는 최신 profiles/teachers context로 계속 매핑한다. 기존 requester/status 전이, 원본 createdAt 기준 연도, 최신 actor role·관리자 override·결재자 연결·수업/실제회차 검증, expectedStatus/UUID와 patch 제외필드, receipt·알림 await/실패경고를 유지한다. 새 detail consumer는 기존 단건RPC의 엄격한 DTO/timeout/null 계약을 사용하므로 오류 문자열까지 완전 동등하다고 주장하지 않는다. 기존 optional catalog 읽기 정책은 변경하지 않는다. SQL·RLS·ACL·인증·서버 mutation은 변경하지 않는다.

합성 transport에서 실제 서비스와 기존 wire consumer를 실행했다. 기준은 c7d2f967db8969d28b43dcdee414c3157013581c, Node22.18.0과 동일 package-lock 의존성이다. 12개 수업·20개 신청·40개 이력·24개 회차가 있는 non-empty fixture이며, read/mutation/session/notification transport당40ms를 주고 각각5회 실행했다. TypeScript transpilation은 측정에서 제외했다. 서비스가 기다리는 mutation·session·알림 시간은 양쪽에 동일하게 포함한다. 모든 transport는 메모리 fixture이며 실제DB/알림은 호출하지 않았다.

| 지표 | 기준 | 변경 후 |
| --- | ---: | ---: |
| 사전 읽기 수 | 9 | 5 |
| 읽기 응답 JSON 바이트 | 41,807 | 8,973 |
| 총 서비스 합성 중앙값 | 252.41ms | 211.54ms |
| mutation 호출 | 1 | 1 |
| 알림 시도 | 1 | 1 |

읽기 payload는78.5%, 합성 중앙값은16.2% 줄었다. request UUID만 정규화한 mutation payload와 반환 DTO의 SHA256이 전후 동일하다. 이 fixture 크기·고정 transport 지연은 운영데이터 규모, RPC내부 DB비용, 브라우저 렌더나 현장 p95를 대표하지 않는다.

집중 회귀220/220, 신규 재상신23개에 대한 독립 실행23/23 및 독립 정적 findings0을 확인했다. 사전 실패는 mutation0/알림0, 성공은 mutation1/알림1, mutation 충돌은 재시도·알림없음, 알림 실패는 committed결과+warning, 알림 완료 전 pending을 검증한다. 참여자 변경 표시이름·두 허용 상태·연도·관리자역할·실제회차도 포함한다. 이 결과는 운영 실제 재상신을 실행한 증거가 아니다.

재현:

    node scripts/measure-makeup-resubmit-performance.mjs c7d2f967db8969d28b43dcdee414c3157013581c --compare
    node --test --experimental-strip-types --test-name-pattern='^resubmit ' tests/makeup-approval-performance.test.mjs

기존필수 CI가 선택하는 performance 스위트에 회귀를 편입했으며 workflow 해시 고정은 유지했다. 운영 반영·조회 결과와 남은 한계는 별도 최종 실행 기록에 결속하며, 운영의 실제 재상신·알림은 이번 범위에서 실행하지 않는다.
