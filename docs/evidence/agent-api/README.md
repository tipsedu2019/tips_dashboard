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

- HTTP 9개: 기본 비활성, 익명 차단, 토큰 해시 전달, 잘못된/추가 입력 차단, 요청 크기/타입 제한, 오류 정제, 실패 영수증/unknown 유지, OpenAPI.
- 새 pgTAP 52개: 명시적 admin/issuer 재검사, 키 범위·만료·폐기·분당 제한, 개인 필드 제외, 미리보기 전체 rollback, 멱등 재실행, 다른 키/다른 본문 거부, 과거 기록 보존, 두 저장 방식 지원, 동시 충돌 재검사와 최종 SQLSTATE 23P01, 알림/이력 무변경, ACL, 기존 수업/계정 삭제 흐름과 감사 이력 유지.
- 기존 timetable_operational_conflicts_test.sql 127개 통과.
- 격리 DB lint 및 현재 배포 계약 검증 통과. 격리 런타임은 검사 후 정리됨.
- TypeScript, 변경 파일 ESLint, Next production build 통과. 빌드 런타임에서 OpenAPI 200과 기본 비활성 health 503/no-store를 확인했습니다.
- 실제 Vault → HTTPS 헤더 치환과 실제 운영 쓰기는 아직 검증되지 않았습니다. Muse의 19개 CLI 자체 테스트는 Muse 보고 결과입니다.

재현 명령 및 활성화 절차는 [Muse 연동 문서](../../../integrations/muse/README.md)에 있습니다.
