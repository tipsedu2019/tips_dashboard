# Dashboard Existing-Surface Polish Design

**Date:** 2026-07-15

**Status:** Approved

**Depends on:** [Common Notification Control Plane Design](./2026-07-15-common-notification-control-plane-design.md)

## 목적

이미 실사용 중인 대시보드의 기존 지표·학생 분포·수업 운영 화면을 유지하면서, 자주 쓰는 조작을 바로 노출하고 잘못된 요약과 신뢰할 수 없는 알림 상태를 제거한다. 이번 변경은 새 업무 통합 대시보드를 만드는 프로젝트가 아니라 현재 화면의 정확성, 동선, 피드백을 개선하는 안정화 작업이다.

## 범위

이번 변경은 다음만 포함한다.

1. 현재 개인 기준이 아닌 `할 일` 완료 수를 표시하는 상단 업무 요약을 제거한다.
2. 과목과 부서 필터를 접힌 메뉴 밖으로 꺼내 항상 보이게 한다.
3. 전체 권한 사용자의 사이드바와 빠른 이동에서 대시보드를 운영 메뉴 첫 항목으로 옮긴다.
4. 알림을 페이지 이동 없이 개인별로 읽음 처리할 수 있게 한다.
5. Web Push가 실제로 사용할 수 있는지 단계별 상태와 다음 행동을 보여주고, 현재 로그인 사용자의 현재 기기에만 고정 테스트 알림을 보낼 수 있게 한다.

## 명시적 비범위

- 할 일, 영어 단어 재시험, 등록, 전반, 퇴원, 휴보강, 전자결재를 한 데이터 모델로 집계하지 않는다.
- `내가 해야 할 일`, `내가 요청한 일`, 단계별 업무 수 또는 통합 마감순 목록을 추가하지 않는다.
- `ops_tasks`, `makeup_requests`, `approval_requests`를 합치는 새 loader, view, RPC 또는 materialized projection을 만들지 않는다.
- 조교에게 `/admin/dashboard` 접근 권한을 새로 주지 않는다.
- 기존 운영 지표 계산, 학생 분포, 시험 충돌, 수업 운영 집계의 의미를 바꾸지 않는다.
- 페이지를 여는 것만으로 Notification 권한을 요청하거나 실제 테스트 Push를 발송하지 않는다.

통합 업무 요약은 운영 상태 판정과 개인 역할 정의가 별도 승인된 뒤 후속 프로젝트로 다룬다.

## 현재 문제와 결정

### 부정확한 상단 업무 요약

현재 `OpsTaskDashboardSummary`는 `ops_tasks.type = general`만 읽는다. 받은함과 보낸함은 현재 사용자를 부분적으로 고려하지만 완료 수는 모든 사용자의 완료된 일반 할 일을 센다. 따라서 `완료 2` 같은 값은 개인 업무 현황으로 해석할 수 없다.

이번 변경은 이 컴포넌트를 확장하지 않고 대시보드에서 제거한다. 다른 소비자가 없으면 컴포넌트와 전용 경량 loader/test 계약도 함께 삭제한다. 빈 공간을 새 카드나 설명으로 채우지 않고 기존 필터와 지표가 바로 시작하게 한다.

### 접힌 빠른 필터

현재 데이터와 state는 이미 아래 모든 조합을 지원하지만 한 개의 `전체 범위` 드롭다운 안에 숨겨져 있다.

- 과목: `전체`, `영어`, `수학`
- 부서: `전체`, `초중등부`, `고등부`

드롭다운을 제거하고 두 개의 segmented control을 항상 노출한다. 한 축에서 하나만 선택할 수 있고 두 축의 선택은 독립적이다. 기존 `activeSubject`, `activeDivision`, `analyticsByView` 계산을 그대로 사용하므로 데이터 layer는 변경하지 않는다.

Desktop에서는 `과목`과 `부서`를 같은 행에 두고 운영 상태 badge를 우측에 둔다. Mobile `390px`에서는 과목과 부서를 각각 한 행에 배치한다. 버튼을 잘라내거나 필터를 다시 메뉴에 접거나 페이지 가로 스크롤을 만들지 않는다. 각 control은 visible label, `role`/선택 상태, 키보드 focus를 제공한다.

### 대시보드 메뉴 순서

`buildAdminNavGroups`의 `fullOverviewItems`에서 대시보드를 첫 항목으로 옮긴다. 사이드바와 빠른 이동은 같은 navigation source를 사용하므로 둘의 순서가 함께 바뀐다. Assistant 전용 메뉴와 `AuthGuard` 허용 경로는 변경하지 않는다.

## 알림함과 읽음

읽음 데이터, RPC, RLS의 authoritative 계약은 Common Notification Control Plane Design이 소유한다. 이 화면은 그 계약을 다음처럼 소비한다.

- 알림 본문/제목 영역은 기존 목적지로 이동하는 Link다.
- 각 unread 항목에는 Link의 sibling인 `읽음` 버튼이 있다. Link 안에 button을 중첩하지 않는다.
- `읽음` 버튼은 route를 바꾸거나 popover를 닫지 않는다.
- 버튼은 per-notification pending 상태를 표시하고 중복 클릭을 막는다.
- 성공 시 dot과 badge를 `newly_read`/server unread count에 맞춰 한 번만 갱신한다.
- 실패 시 읽지 않은 상태를 유지하고 해당 popover 안에서 재시도 가능한 오류를 보여 준다.
- 알림 본문을 누르면 목적지 이동을 우선해 차단하지 않는다. 이동 전에 읽음 RPC를 시도하되 성공한 경우에만 local dot/count를 갱신하고, 실패하면 해당 항목을 unread로 남겨 다음 알림함 조회에서 다시 보이게 한다. 본문 이동 실패와 읽음 실패를 같은 성공으로 위장하지 않는다.

팀 알림의 한 `read_at` 값을 모두가 공유하지 않는다. 새 canonical notification은 profile별 projection/read receipt를 사용하고 legacy 팀 row도 `(notification_id, profile_id)` receipt overlay를 사용한다. Browser는 viewer profile ID를 입력하지 않으며 RPC가 `auth.uid()`로 현재 수신자를 판정한다. Inbox 목록과 unread count는 같은 visible relation을 사용하고 client-side 본문 grouping으로 개수를 바꾸지 않는다.

## Web Push 신뢰성

단순한 `설정 필요`, `꺼짐`, `켜기`만 표시하지 않는다. 현재 브라우저 기준으로 아래 준비 상태를 순서대로 진단한다.

1. Push/Notification/Service Worker API 지원 여부.
2. HTTPS 또는 localhost secure-context 여부.
3. 공개 VAPID 키와 서버 발송 설정의 준비 여부.
4. 브라우저 Notification 권한: 요청 전, 허용, 차단.
5. `/sw.js`와 manifest asset의 실제 등록 가능 여부.
6. 현재 browser subscription 존재 여부.
7. 현재 subscription endpoint가 현재 로그인 profile 소유로 서버에 저장되어 있는지.
8. 최근 self-test 결과.

UI는 사용자가 지금 할 수 있는 다음 행동 하나를 상태별로 보여 준다. 환경 키나 server asset이 빠진 상태에서는 사용자에게 의미 없는 `켜기` 버튼을 활성화하지 않고 운영 설정이 필요하다고 명확히 표시한다. 권한이 차단된 경우 브라우저 설정에서 복구하는 짧은 안내를 제공한다. 계정이 바뀐 공유 브라우저에서는 기존 endpoint 소유자를 그대로 신뢰하지 않고 현재 profile로 검증·재바인딩하거나 안전하게 실패한다.

`내 기기로 테스트 알림 보내기`는 명시적 클릭에서만 실행한다. 현재 `auth.uid()`가 소유한 현재 browser subscription만 대상으로 하고 title, body, href, profile, team을 입력받지 않는다. 서버의 고정 테스트 template와 same-origin link를 사용하며 결과는 `sent`, `expired`, `failed`와 정규화된 code만 반환한다. 실제 workflow dispatch flag나 Google Chat/SOLAPI를 건드리지 않는다. 자동 테스트는 provider fixture를 사용해 실제 Push를 보내지 않는다.

## 오류와 보안

- 자유 형식 `/api/web-push` payload는 self-test에 재사용하지 않는다.
- 다른 profile의 notification, receipt, subscription을 조회하거나 변경할 수 없다.
- VAPID private key, subscription auth key, endpoint 전체, service-role 상태는 UI·일반 로그·감사 응답에 노출하지 않는다.
- Service Worker는 Push payload parse 실패를 안전하게 처리하고 click href를 same-origin allowlist로 제한한다.
- 푸시 준비 상태 조회 실패를 `미지원`으로 오표시하지 않고 `상태 확인 실패`로 구분한다.
- 기존 운영 지표 조회 실패와 알림 준비 상태 실패는 서로 영향을 주지 않는다.

## 접근성과 반응형

- 필터, 읽음, Push 설정·테스트는 icon만으로 의미를 전달하지 않고 visible text 또는 정확한 accessible name을 갖는다.
- 선택 필터, unread, pending, error 상태는 색상만으로 구분하지 않는다.
- keyboard만으로 segmented controls, notification Link, 읽음 버튼, Push action을 사용할 수 있다.
- Desktop `1349x987`과 Mobile `390x844`에서 page/popover 가로 overflow가 없다.
- Mobile 알림 항목에서 본문 Link와 읽음 버튼의 touch target이 겹치지 않는다.

## 검증 기준

### 모델과 소스 계약

- 대시보드 페이지가 `OpsTaskDashboardSummary`를 렌더링하지 않고 새 업무 집계 loader/RPC를 호출하지 않는다.
- 필터는 기존 두 state와 기존 analytics bucket만 변경한다.
- 대시보드가 전체 권한 navigation의 첫 항목이고 assistant 접근 정책은 그대로다.
- Inbox list, unread count, mark-read가 같은 current-profile visibility contract를 사용한다.
- Push readiness와 self-test는 임의 수신자·본문·링크를 받지 않는다.

### 상호작용

- 여섯 visible filter 선택이 즉시 기존 지표/분포/수업 운영에 반영된다.
- `읽음` 버튼 클릭은 URL과 popover open 상태를 유지하고 badge를 정확히 한 번 줄인다.
- 읽음 실패는 이동 없이 표시되고 재시도할 수 있다.
- 알림 Link 클릭은 기존 목적지 이동을 유지한다.
- Push 권한 요청은 사용자 gesture에서만 발생한다.
- 미지원, insecure, key 미설정, 권한 대기, 차단, service-worker 실패, account binding mismatch, subscribed, self-test 성공/실패 상태를 fixture로 재현한다.

### 실제 브라우저 QA

- `http://localhost:3000/admin/dashboard`에서 `1349x987`, `390x844` 두 viewport를 확인한다.
- 필터 조합별 KPI와 학생/수업 패널 변화, 메뉴 순서, popover 읽음 비이동을 실제 클릭으로 검증한다.
- Console/runtime error와 horizontal overflow가 없어야 한다.
- 자동 검증 중 외부 Google Chat, Web Push, SOLAPI 호출 수는 0이어야 한다.
- 실제 Push 성공을 주장하려면 별도 확인된 환경에서 asset·VAPID·현재 profile binding을 먼저 검증하고 사용자가 명시적으로 누른 self-test 한 건을 수신해야 한다. 준비 조건이 없으면 `blocked`로 보고하며 작동한다고 표현하지 않는다.

## 후속 범위

업무 통합 요약을 다시 시작할 때는 별도 설계에서 각 workflow의 `내가 해야 할 일`, `내가 요청한 일`, 완료 참여자, 단계, 권한, 부분 실패 의미를 먼저 정의한다. 이 문서의 필터·navigation·읽음·Push 계약은 그 후속 집계와 독립적으로 유지한다.
