# 수업 저장 후 조회 대기 — 다음 성능 후보

기준 main: `22a248abdf2b1eeef97647ee5cd02143b67dedc8` (PR119–122 보존). 새 원격 읽기로 확인했으며 PR121/122를 재배포하지 않았다. 별도 worktree/branch에서 한 후보만 다룬다. 운영 DB·로그·학생·알림 조회나 운영 부하검사를 추가하지 않았다.

## 남은 후보 비교

| 영역 | 기존 코드상 근거 | 선택 판단 |
| --- | --- | --- |
| 수업 저장 후 조회 | `management-page.tsx`의 `reconcileManagementPage`: `refresh()` 종료 뒤 선택된 `loadDetail(id)` 시작 | **이번 후보 하나**. 두 read가 서로의 결과·캐시를 사용하지 않으며 같은 커밋 뒤 실행된다. 클래스 상세를 유지한 저장 등에 반복 적용되므로 구조적으로 한 독립 read 대기를 줄일 수 있다. 실제 빈도/운영시간 순위는 미측정. |
| 교재 | `use-textbook-numbered-data.ts`의 visible refresh가 이미 `Promise.all`, 업무별 invalidation도 범위 제한 | 목록 전체가 직렬이라는 근거 없음. 재고·금액 사전검증/쓰기 순서를 바꾸지 않음. |
| 시간표 | transfer session이 afterCommit → plan refresh, operational callback이 공개캐시 → 운영 range를 기다림 | 후보는 있으나 커밋된 영수증·복구 상태·권한/plan 전환 계약이 더 복잡해 이번에 선택하지 않음. |
| 공통 권한/세션 | auth provider에 resolved session 재사용·in-flight 합치기 이미 존재, profile fallback은 ID 조회 무결과에 의존 | 병렬화/캐시 연장으로 교차 사용자 노출이나 revocation 지연을 만들 근거가 없음. 미변경. |
| 자동 이력 | task-scoped 전체 event 및 before/after payload가 상세 응답에 포함 | 큰 합성 이력으로 비용 증가 가능성은 있지만 운영량·비용 미측정. lazy load/페이지는 정보 완전성 계약이 필요해 미선택. 임의 limit/삭제 금지. |

공개 수업 캐시의3초 timeout은 상한이며 실측 지연이 아니다. 실제 버튼 총시간의 가장 큰 병목이라고 단정하지 않는다.

## 독립성과 안전 경계

목록 `refresh()`는 현재 actor scope의 metadata를 무효화하고 numbered page controller를 재조회한다. `loadDetail()`은 같은 selected ID로 독립 단건 RPC를 읽고, 응답 전후 authorization token을 검사해 owner가 달라지면 null을 반환한다. 상세 read는 목록/metadata 결과를 사용하지 않는다. 권한과 role에 따라 `ManagementPageContent`가 재마운트되고 unmount/닫기 때 detail request generation이 바뀐다. 저장 호출자는 이 generation을 확인한 뒤에만 상세·완료 메시지를 반영한다.

수업(`kind === "classes"`)과 selected ID가 있는 경우만 병렬화한다. 학생·교재 및 선택 ID 없는 목록 갱신은 기존 순서다. 두 read가 모두 settle할 때까지 기다리고 Promise가 reject할 때의 목록 오류 우선순위와 상세 오류를 보존한다. 저장 잠금을 먼저 해제하지 않는다. 정상 read 수·projection·limit·timeout·actor scope·SQL·RLS·권한·쓰기·알림·idempotency는 바꾸지 않는다. 실패 시에도 두 read를 시작하므로 기존 순차 경로에서 목록 throw 때문에 시작하지 않았을 상세 read가 추가될 수 있다. 한 read가 먼저 reject해도 다른 read의 기존 종료/timeout까지 기다리므로 실패 경로가 모두 빨라지는 것은 아니다.

기존 numbered controller는 일반 목록 오류를 `snapshot.error`로 게시하고 Promise를 resolve한다. 따라서 throwing stub 회귀는 callback의 reject 처리만 입증하며 모든 실제 목록 오류가 저장 성공 메시지를 막는다는 뜻은 아니다. 이 기존 오류 계약은 이번 범위에서 바꾸지 않았다. Stats/filter metadata도 기존처럼 독립 비동기로 실행되므로 두 read의 settle이 metadata 완료를 의미하지 않는다.

참조 화면은 기존 수업관리 목록/상세이며 공유 table/dialog/form/save controls와 디자인 토큰은 그대로다. UI 상태 확인은 실제 production React page를 synthetic transport/DOM으로 실행하는 기존 회귀 harness를 사용한다. 이 검증을 운영 브라우저나 실제 UI 지연 측정이라고 부르지 않는다.

## 측정·검증

`scripts/measure-management-refresh.mjs`는 TS AST로 **실제 production callback 본문**을 추출해 transpile/실행한다. 기존 함수를 fixture에 재구현하지 않는다. 고정 base의 원문과 수정 원문에 같은 비어 있지 않은 합성 상세를 주고 list/detail에 각각80ms, 각각5회 측정했다. Node22.18.0과 lockfile 일치 의존성을 사용한다. 컴파일은 측정에서 제외했다.

| 합성 경로 | 전 중앙값 | 후 중앙값 | 조회 수 |
| --- | ---: | ---: | --- |
| 수업 + selected ID | 162.44ms | 81.21ms | 2→2 |
| 학생 + selected ID (대조군) | 162.32ms | 162.05ms | 2→2 |
| 교재 + selected ID (대조군) | 162.04ms | 162.34ms | 2→2 |
| selected ID 없는 목록 | 81.18ms | 81.21ms | 1→1 |

수업 재조회 구간만 약81.23ms(50.0%) 감소했다. 반환 JSON SHA256은 모든 ID 조회에서 `85ee0991774e57e2e2191fad6b7d536482db9a878d8d4d280473f47a729c4319`로 동일했다. 두 read의 시작·종료 시각과 전체 source/callback hash도 기록했다. 대조군의 미세한 차이는 스케줄링 변동이다. 이 결과는 고정 지연 합성 환경에서 한 대기 단계가 제거됨을 보여 주며, 운영 read latency·완료 버튼 총시간 개선율을 뜻하지 않는다. 저장 RPC/공개캐시/렌더도 제외한다.

```sh
node scripts/measure-management-refresh.mjs 22a248abdf2b1eeef97647ee5cd02143b67dedc8 --compare
```

최종 검증 결과:

- 실제 production React page를 합성 transport/DOM으로 실행한 상세 화면 회귀96/96 통과. 신규11개는 병렬 시작, 두 read 종료 전 중복 저장 잠금, reject 순서, 계정/role 변경, 닫기/다시 열기, 쓰기 실패, no-ID/학생/교재 대조군을 다룬다.
- 주변 수업 일정·번호 페이지·필터·권한별 request lifecycle·수업 생성/종료·학생 상세/이력 등17개 테스트 파일218/218 통과. 앞선96개와 중복 없이 총314개다.
- TypeScript, 변경파일 ESLint, Next.js production build, `git diff --check` 통과.
- 독립 reviewer가 제품 source와 read hook/service/controller 및 호출자를 검토했고, 최종 파일 해시를 전후 확인해 신규11개를 별도 실행했다. 통과했으며 blocking 발견 없음.

검증된 제품 source SHA-256: `3840131258c37704d540f9360185cdee1876f51e8aee1fc967571bced72855b6`. 테스트: `0f3e0319a9173f1b22e456cf066c883dde7c18822e554d56dce0682cf8b2f6f9`. 측정 script: `b516f76eb626c77fc359f69d536fc57dfd8c0c54299e20582956dc44f3964d03`.

이번 후보의 운영 브라우저/실제 저장 지연은 미측정이며 UI 시각 변경도 없다. 호스티드 필수 체크와 전체 SQL 검증을 통과했다고 주장하지 않는다. 기존 Actions의 runner 시작 전 billing 제한과 전체 로컬 Supabase/Auth baseline 문제를 이유로 유료 조치나 보안 변경을 하지 않았다. DB와 권한 변경이 없는 이번 callback 변경은 위 영향 범위 회귀로 검증했다. 새 초안 PR은 병합·배포 순서 조율 전까지 초안으로 유지한다. 실학생 저장·관계 변경·승인·취소·발송은 수행하지 않았다.

## 성능과 분리한 자동 이력 표시 결함

기존 운영에서 등록 상세 → 자동 이력 열기 시 레거시 항목1개의 제목이 원시JSON인 현상을 이미 읽기 관찰했다. 기대는 사람이 읽을 업무 제목이며, 실제 화면에 internal metadata 키가 길게 표시됐다. 원본 이름·ID·payload는 이 문서에 복사하지 않는다.

수정안은 `registration-track-service.ts`의 legacyText 매핑과 `registration-track-history.js`의 eventTitle을 대상으로, 구조화 JSON인지 판별 가능한 legacy payload만 안전한 업무 제목으로 변환하고 일반 레거시 문구/이력 원문은 보존하는 것이다. 합성 case_created payload·일반 문장·잘못된 JSON·알 수 없는 event에 대한 표시 회귀가 선행해야 한다. DB 이력 수정/삭제·임의 문자열 자르기는 필요하지 않다. 이번 성능 후보에는 섞지 않는다.
