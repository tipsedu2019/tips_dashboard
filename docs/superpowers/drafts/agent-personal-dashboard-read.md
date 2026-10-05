# 개인 대시보드 업무 읽기 — 로컬 최소 단위

기준은 로컬 `52b0e2e2` 이후 추가 커밋이다. 기존 615 DB assertion, 네 브라우저 조합, 267/269 Node 결과와 54개 보존 자료를 변경하지 않는다. 이 단위는 일반 업무 읽기의 코드·SQL 초안·합성 HTTP 계약이며 운영 준비 완료 또는 실제 DB 권한 검증을 뜻하지 않는다. 신규 SQL을 설치·실행하거나 키를 발급·변경하지 않는다.

## 현재 대시보드와의 관계

`getRoleCapabilities`는 교사에게 수업계획·시간표·학사일정 사용을 허용한다. 현재 classes/students/academic_events SELECT RLS는 authenticated 사용자에게 넓게 열려 있다. UI가 관리 메뉴를 숨기는 동작만으로 교사별 행인가가 보장되지 않는다. 최종 중앙 `agent_api_v2`는 `20261002130443_past_state_correction_reference_reuse.sql:284`이며 발급자 `created_by`를 관리자 actor/JWT claims로 사용한다. 이를 개인 키에 적용하지 않는다.

최소 개인 읽기는 **현재 교사의 대시보드 권한 이하**로 제한한다. 모든 callback은 현재 teacher 역할과 Auth 삭제·ban 상태를 다시 검사한다. 수업 callback은 명시 class grant와 현재 배정의 교집합을 읽고 `timetable_teacher_eligible_v1`의 profile/catalog UUID 상호 연결 규칙을 재사용한다. 학교 callback은 교사의 공용 학사일정 읽기를 독립적인 명시 school grant로 제한하며 교사 catalog 연결이나 본인 학교 배정을 추론하지 않는다. 이름을 소유권으로 해석하거나 전교 수업 조회 범위를 자동 부여하지 않는다.

## 별도 타입과 경계

| 구분 | 이번 계약 |
| --- | --- |
| 요청함 키 | 기존 `tips_agent_`/AI request credential 경로 유지. 일반 업무 scope로 변환하지 않음 |
| 중앙 업무 키 | 기존 `agent_api_v2`와 `agent_calendar_api_v1`, 기존 발급·UI·scope·행동 유지 |
| 개인 업무 읽기 | 별도 `tips_dashboard_personal_` bearer, kind `personal_dashboard_read`, audience `tips_dashboard_personal`, 별도 store·전용 RPC |

개인 업무 store에는 실제 발급기가 없다. 새 hash·owner·issuer·scope·class/school grant·expiry를 기존 키에서 복사하거나 변경하는 실행을 하지 않는다. 소유자·발급자·kind·audience·hash·grant·expiry는 불변이다. 발급자의 현재 admin/Auth 상태도 보수적으로 검사하지만, 발급자 JWT로 조회하거나 그 역할을 owner 권한으로 사용하지 않는다. 역할이 teacher에서 바뀌면 승진을 포함해 차단한다.

신규 v2 HTTP dispatch는 이 별도 family만 전용 읽기 handler로 보낸다. 같은 family의 malformed token은 중앙 gateway로 fallback하지 않는다. 알려진 개인 업무 family를 요청함/Chat 인증에 제출하면 employee Auth provider나 bot RPC에 전달하기 전에 로컬에서 거부한다. 다른 모든 bearer 형식의 처리까지 새로 정의했다고 주장하지 않는다.

## 지원하는 읽기

- `GET classes/{id}?from&to`: 명시 class UUID grant, 현재 수강·미종강 normalized 수업, 현재 주간 slot UUID와 owner profile/catalog 상호 연결을 모두 만족해야 한다. legacy 이름 배정, 과거 회차만의 연결, 개강 준비·종강·배정 누락은 초기 단위에서 차단한다.
- `GET calendar/schools?search&page`: 명시 school UUID grant로 먼저 제한한 페이지·total만 반환한다. 빈 grant는 전체를 뜻하지 않는다.
- `GET calendar/schools/{id}?schoolYear`: 교사의 기존 공용 학사일정 읽기와 명시 school grant를 함께 확인한다. 학생 학교 텍스트·명단으로 학교 권한을 추론하지 않는다.

수업 응답은 기존 `classWorkspace`의 일정 projection을 재사용하되 모든 쓰기 capability를 false로 표시한다. 기본 정보는 이름·수업유형·과목·영역·학년으로 한정하고 fee/capacity, 학생·연락처·보호자·상담·학습 내용·메모·raw plan/catalog를 반환하지 않는다. 일정 ID·날짜·상태·시간·교사/교실 UUID만 제공한다. version은 숨은 note나 whole row를 해시하지 않고 안전한 projection에서 계산한다.

학교 일정은 기존 `calendarWorkspace`의 안전한 projection을 재사용하고 읽기 전용임을 표시한다. 학교·연도 및 id/title/type/date/grade만 제공한다. raw note·description·source·학생 연결은 없다. canonical 공용 학사 유형 여섯 개만 허용하고 `[[TIPS_MAKEUP]]` 표식과 알 수 없는 유형은 제외한다. 별도의 개인 일정 표식을 새로 정의하지 않는다. note에서 얻는 다일 범위·시험학기·과학영역 metadata는 아직 지원하지 않아 이 초기 응답은 저장된 일자 단위다.

POST/PATCH/DELETE, preview/commit, receipt/operation, catalog, 학생·기타 업무·bridge·Chat 호출은 지원하지 않는다. 이 경로들은 RPC 전에 거부한다. caller가 owner/issuer/grant를 query로 바꿀 수 없다. HTTP는 digest와 고정 action만 신규 RPC에 전달하고, 반환 identity/scope/resource 및 모든 중첩 DTO를 엄격하게 검사한다. private 필드가 섞인 producer 결과는 503으로 차단한다. 매 GET·재시도마다 현재 DB callback을 호출하며 이전 성공 데이터/receipt를 재생하지 않는다.

## 검증 범위

합성 Node 검사는 별도 RPC producer fixture를 주입해 실제 HTTP dispatch/strict parser/canonical projector를 실행한다. 현재 owner role·삭제/ban·UUID 연결·배정·issuer 상태·scope 거부, 타교사·다른 class·누락 owner, 재시도, 교차 family, write RPC 0건, unknown/private 필드와 DB 오류 redaction을 검사한다. fixture의 grant 거부는 upstream authority denial 계약 검증이며 불변 store grant UPDATE 기능의 증거가 아니다.

신규 Node 38개가 통과했다. 관련 전체 23파일은 307개 중 305개 통과·기존 formal parity capture 누락 두 개 실패·skip 0이며 TypeScript와 변경 앱 파일 ESLint도 통과했다. 새 SQL 초안과 pgTAP 소스 110개 assertion은 정적으로 검토했으나 실행하지 않았다. 실제 RLS/ACL/row lock/SQLSTATE 실행이나 SQL→TS producer parity를 통과했다고 주장하지 않는다. 이전 615 DB 검증은 요청함 개인 소유자 범위이며 이 신규 일반 업무 callback의 DB 증거로 대체하지 않는다. 신규 store/RPC가 설치되지 않은 현재 운영 환경에서는 개인 업무 bearer로 읽을 수 없다.

정식 parity 두 개의 정확한 생성 경로는 original driver의 baseline → 147개 forward migration → SQL 88개와 probe 17개 → committed-prefix 검증 → 현재 실행 SQL HTTP/Chat capture → consumer 두 개다. 실제 운영 credential/Chat 발송은 필수 전제가 아니다. 독립 검토한 `52b0e2e2` 계획은 closure 27개와 정확 inventory를 보존했으나, 기존 CLI/daemon의 pull·업데이트 외부 통신 차단과 전체 image graph가 입증되지 않아 실행 HOLD다. 캐시 CLI 2.103.0은 CI 2.115.0과 동일하지 않다. internal bridge/cache 존재로 외부 통신 0을 주장하지 않는다. guard·original driver/CLI를 수정하거나 focused receipt로 대체하지 않는다. 현재 추가 Auth source 변경이 있으므로 52b 계획은 해당 과거 head의 계획으로만 보존하고 새 커밋의 capture로 사용하지 않는다.

## 아침 결정 목록

1. 현재 담당 수업을 주간 normalized slot UUID로 제한한 초기 규칙을 확대할지: 과거/현재 회차 배정, legacy 이름 배정, 개강 준비·종강 조회는 현재 미지원이다. 권한 매핑이 확정되기 전에는 차단을 유지한다. 교사 공용 학교 일정의 명시 school grant에 추가로 본인 학교 배정이 필요한지도 결정해야 한다. 현재 이를 학생 명단으로 유추하지 않는다.
2. 퇴사 상태의 정확한 운영 marker와 issuer 권한 상실 정책: 현재 role 변경·Auth 삭제/ban·UUID 연결 상실을 차단하며 `teacher_catalogs.is_visible`만으로 퇴사를 단정하지 않는다. issuer admin/Auth 상실도 초기 계약에서는 차단한다.

쓰기·기타 API 연결, 발급·scope 확대·owner 설정, SQL 설치/권한 부여, polling/provider/실제 종단 발송, push/PR/병합/배포는 별도 적용 경계다. 기존 고정 7개 SQL·CI·공개 사이트·bridge·CLI·PR97 hold 및 원본 dirty 변경은 보존한다.
