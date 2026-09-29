# AI 연결 검증 — 2026-09-29

합성 데이터만 사용하는 loopback transport에서 실제 Next 화면을 확인했습니다. 실제 연결 키, 학생·납부 데이터, 운영 DB, 외부 발송은 사용하지 않았습니다.

## 화면 증거

| 상태 | AI 연결 | 기준 화면 |
|---|---|---|
| 데스크톱, 라이트, 1개 행 | [연결 목록](agent-list-desktop-final.png) | [학교 설정](reference-school-desktop.png) |
| 390×844, 다크, 1개 행 | [연결 목록](agent-list-mobile-dark-final.png) | [학교 설정](reference-school-mobile-dark.png) |
| 발급 폼 | [데스크톱](agent-key-form-desktop-final.png) | [390px 다크](agent-key-form-mobile-dark.png) |

공통 SettingsWorkspaceShell/MasterHeader/TableFrame, 표 셀 토큰, NativeSelect/Input/Button/Checkbox, Form/Detail/ConfirmationDialogContent, ActionFeedback, DataTablePagination을 재사용했습니다. 공통 스타일 변경이나 예외 추가는 없습니다. 학교 기준 행과 연결 행은 서로 다른 업무 엔터티의 합성 1개 행입니다.

실제로 확인한 동작:
- 관리자 목록 진입, 기본 조회 권한·1일 만료·학사일정 별도 선택.
- 수업 미선택 시 발급 비활성; 선택한 한 수업으로 합성 발급 요청.
- 발급 직후 키는 마스킹하고 한 번만 표시; 닫은 뒤 다시 조회되지 않음.
- 폐기는 취소 버튼에 먼저 포커스; 합성 폐기 뒤 `폐기됨`과 버튼 비활성.
- Escape로 발급 폼 닫기 및 발급 버튼 포커스 복원.
- 목록 응답 실패 시 오류·새로고침·페이지 이동 차단.
- viewer 계정으로 직접 URL 진입 시 관리 기능과 메뉴가 나타나지 않음.
- 모바일 표 가로 스크롤 영역과 오른쪽 작업 열, 다크 테마 폼.

## API/DB 증거

- HTTP 11개: 기본 비활성, 익명 차단, 토큰 해시 전달, 잘못된/추가 입력 차단, 요청 크기/타입 제한, 오류 정제, 실패 영수증/unknown 유지, OpenAPI, 저장 후 공개 캐시 갱신 및 갱신 실패 시 applied 유지. 기존 공개 캐시 회귀를 포함한 20개 통과.
- 새 pgTAP 52개: 명시적 admin/issuer 재검사, 키 범위·만료·폐기·분당 제한, 개인 필드 제외, 미리보기 전체 rollback, 멱등 재실행, 다른 키/다른 본문 거부, 과거 기록 보존, 두 저장 방식 지원, 동시 충돌 재검사와 최종 SQLSTATE 23P01, 알림/이력 무변경, ACL, 기존 수업/계정 삭제 흐름과 감사 이력 유지.
- 기존 timetable_operational_conflicts_test.sql 127개 통과.
- 격리 DB lint 및 현재 배포 계약 검증 통과. 격리 런타임은 검사 후 정리됨.
- TypeScript, 변경 파일 ESLint, Next production build 통과. 빌드 런타임에서 OpenAPI 200과 기본 비활성 health 503/no-store를 확인했습니다.
- 실제 Vault → HTTPS 헤더 치환과 실제 운영 쓰기는 아직 검증되지 않았습니다. Muse의 41개 CLI 자체 테스트는 Muse 보고 결과입니다.

재현 명령 및 활성화 절차는 [Muse 연동 문서](../../../integrations/muse/README.md)에 있습니다.

## 수업 수정 API v2

- 기본 정보, 기존 주간 슬롯, 미래 날짜별 휴강/보강의 단일 수업 일괄 변경을 추가했습니다. 대상을 먼저 읽고 exact ID로 미리보기 → 저장 → 결과 해시 대조를 수행합니다. 과거 기록 수정·승인 전환·외부 발송은 제공하지 않습니다.
- v2 컴파일러/HTTP 12개 통과: 실제 legacy planner 소비 결과, 학습 내용·과거 이력 보존, 날짜/카탈로그/모호성 거부, normalized 연결 ID, 응답 개인정보 제외, 캐시 실패 복구. 그중 SQL fixture는 실제 JS compiler 출력과 일치함을 검증합니다. v1 HTTP 11개와 공용 캐시 5개를 합한 28개 통과.
- v2 pgTAP 41개와 기존 v1 52개 통과. 실제 compiler JSON이 최종 DB writer에서 저장되는 것을 확인하고, 두 저장 방식·동시 충돌 SQLSTATE `23P01`·일괄 rollback·scope·멱등·승인 경계·계정 정지/폐기·no-send를 확인했습니다.
- 날짜별 일반 수업 시간 변경이 기존 주간 기본값과 자기 충돌하지 않고 해당 날짜의 한 회차만 대체하는 것을 검증했습니다. 다음 주는 원래 시간이며, 편집 자원의 catalog 비활성화도 실행 시 다시 검사합니다.
- 기존 legacy content preservation, scoped occupancy, lesson save performance pgTAP도 함께 통과했습니다. 격리 DB lint 및 postdeploy 계약을 확인하고 런타임을 정리했습니다.
- 설정/탐색/공용 대화상자 회귀와 v2를 합한 81개 통과. 원문 key 발급은 합성 transport의 무권한 fake 값으로만 검사했습니다.
- 새 발급 폼의 [데스크톱](class-edit-scopes-desktop.png)과 [390px 모바일](class-edit-scopes-mobile.png)을 확인했습니다. 기준 화면과 공용 디자인 구성은 위와 같습니다. 수정 권한 미선택 시 발급 비활성, 선택 범위의 정확한 RPC 전달, 읽기/1일 기본값을 확인했습니다.
- Muse는 v2 CLI를 추가하고 자체 mock 25개 통과를 보고했습니다. 운영 배포, 실제 키 발급, Vault/Sentinel 인증, 실제 수업 수정은 아직 수행하지 않았습니다.
