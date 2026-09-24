# Binding global requirements (verbatim plan excerpt)

- 구현 기준은 저장된 `origin/main` `eb23d7d8e1e629ffcf58d0f286aafa1d33deec72`이며 착수 시 원격 최신 상태를 재확인한다. 현재 checkout `9f962dfc`에 바로 구현하지 않는다.
- 현재 작업 폴더의 기존 문서 변경은 보존한다. 구현 착수 시 격리 worktree와 `codex/` 브랜치를 사용한다.
- 프리셋은 독립 계획이다. `개강 준비`, `class_terms`, 옛 수업그룹을 프리셋 저장소로 재사용하지 않는다.
- 선생님 주간·강의실 주간·일별 선생님·일별 강의실은 동일 새 배치+그림자 ID 집합의 네 투영이다.
- 요일은 일요일 0–토요일 6. 저장 시간은 정수 분, 구간은 `[start, end)`, 0 ≤ start < end ≤ 1440.
- 폼의 분 정확도를 보존한다. 눈금은 30분, 드래그 이동 거리는 5분 단위이며 원래 분 오프셋과 길이를 보존한다.
- 모든 학생·대기·출결·수납·교재·회차 이력과 기존 운영 class ID를 보존한다. 신규 복사 수업에는 학생/이력을 복사하지 않는다.
- 이동/복사는 선택 묶음 전체 원자적 처리, 같은 requestKey 재시도는 같은 결과를 반환한다.
- 사용자 후속 설명에 따라 수강→프리셋 실제 이동을 제거한다. 수강은 계속 진행하고 모든 프리셋에서 그림자로 자리를 점유한다. 그림자의 드래그/상태 변경은 불가하다.
- 자동 배치는 사용자가 선택한 '요일·시간 입력 시 즉시 배치 + 빈 시간 추천' 범위다.
- 프리셋 editor 권한과 운영 반영 admin/staff 권한을 분리한다. DB RLS/ACL 및 서버 검사로 강제한다.
- 고객/직원 알림 생성·발송, 학생 자동 이관, 기존 회차 자동 재작성은 하지 않는다.
- 기존 `WorkspaceTabs`, `DataTableFilterPanel`, `TimetableTargetFilter`, Button/Input/Select/Dialog/Sheet, 의미 토큰을 사용한다. 새 커스텀 단축키는 만들지 않는다.
- 기존 최신 디자인과 1440px/390px, 동일 fixture·테마·조건으로 비교한다. 테스트와 브라우저 증거를 구분한다.
- DB 도메인 충돌에 `40001`을 수동 사용하지 않는다. 최종 마이그레이션 정의와 실행 pgTAP으로 SQLSTATE를 검증한다.
- 계획 문서 작성과 기능 구현·운영 migration·배포는 별개다. 이 작업은 계획 작성 단계까지다.

# Subsequent user instruction
The user said 진행 after the plan. This authorizes local implementation and supersedes only the plan-only sentence. Production migrations, push, publication, deployment, and real operational promotions remain unperformed and outside this turn.

# Repository review requirements
Determine the final active PL/pgSQL definition from the ordered migration chain. Never manually label domain conflicts SQLSTATE40001. Preserve auth, RLS/ACL, locks, idempotency, and no-send. Existing DESIGN/components remain baseline; no custom shortcuts.
