# 시간표 프리셋 출시·복구 runbook

작성 기준: `codex/timetable-presets-20260923`, 원격 기준 `eb23d7d8`, Task 9 시작 `ed3e7a31`. 이 문서는 승인 이후 실행할 순서다. 이 작업에서 운영 DB 조회·migration·배포·실제 수강 반영·provider 발송은 수행하지 않았다. 로컬 결과는 [QA REPORT](../qa/timetable-presets-20260923/REPORT.md)에 있다.

## 출시 순서

1. 검토한 feature 전체 diff와 migration SHA256을 고정한다. `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`의 기존 baseline/capture hash는 변경하지 않는다. 신규 14개 feature migration을 포함한 ordered 목록은 119개다. 최종 참조 읽기와 충돌 guard 성능 정의는 `20260924124904_timetable_legacy_reference_aggregation.sql`이다. 마지막 import 원문 보존 정의는 `20260923164328_timetable_import_original_placement.sql`이다. 현재 코드의 canonical RPC/type와 최종 `pg_get_functiondef`·ACL을 비교한다. DB 도메인 충돌은 `23P01`, stale는 `P0001`; 수동 `40001`로 바꾸지 않는다.
2. UI를 끈 상태에서 승인받은 운영 환경에 ordered schema migration을 적용한다. **Backfill: NONE.** 수강 class의 storage mode, 기존 slot/session IDs, 학생·대기·출결·수납·교재·이력, 옛 preferences를 일괄 변환하지 않는다.
3. 관리자/직원, 연결된 교사 editor/viewer, 미공유 교사, 익명의 실제 권한을 읽기/rollback smoke로 확인한다. public planner 직접 DML 금지, private helper execute 금지, 현재 권한을 먼저 확인하는 receipt replay, shared lock 순서를 확인한다. 기존 app_preferences는 전역 테이블이며 historic 광범위 ACL을 이 기능이 재설계하지 않는다. 새 복구 API는 관리팀 전용이다.
4. 다음 canonical RPC와 일관된 참조 읽기 capability를 확인한다: `list_timetable_plans_v1`, `get_timetable_plan_v1`, `get_timetable_plan_revision_v1`, `list_timetable_share_candidates_v1`, `mutate_timetable_plan_v1`, `mutate_timetable_plan_item_v1`, `get_timetable_operational_reference_v1`, `preview_timetable_plan_transfer_v1`, `commit_timetable_plan_transfer_v1`, `list_timetable_import_sources_v1`, `preview_timetable_plan_import_v1`, `commit_timetable_plan_import_v1`. 누락 RPC/실패한 그림자 읽기를 빈 자리가 있다고 해석하지 않는다.
5. `NEXT_PUBLIC_TIMETABLE_PRESETS_ENABLED`를 `false`로 둔 UI에서 운영 시간표 읽기 smoke를 수행한다. `false`가 아닌 값(기본 true)의 검토된 빌드를 배포하면 프리셋 진입을 노출한다. 이 값은 Next public **build-time** 설정이므로 기존 번들에 런타임 환경값만 바꿔도 적용된다고 가정하지 않는다.
6. 같은 운영 읽기 조건으로 UI smoke를 다시 확인한다. capability 장애가 나면 운영 읽기와 마지막 검증된 프리셋 그림자는 유지하고 신규 배치·반영은 비활성화된다. server 검증은 UI와 별개로 권한·idempotency·충돌을 강제한다.
7. 실제 수강 반영은 선택 수업·대상·move/copy preview를 사용자가 확인한 별도 승인 뒤에 실행한다. Realtime provider 수신, 공개 수업 cache invalidation, 실제 운영 결과는 각각 확인한다. 로컬 polling과 synthetic HTTP는 provider Realtime 또는 운영 완료 증거가 아니다.

## 처음 가져오기

`기존 초안 가져오기`에서 새 프리셋 이름과 `개강 준비 수업` 또는 `이전 시간표 초안`을 선택한다. 관리팀만 사용할 수 있다. `선택한 원본 확인` 뒤 정확한 선택/버전을 `새 프리셋으로 가져오기`로 복사한다. 새 plan/item/slot UUID는 서버가 만든다. source class/slot provenance도 서버 원본에서만 정한다.

- 준비 수업은 선택한 기본정보와 normalized slots(분 정확도 포함)를 복사한다. 기존 상태/그룹/학생/이력은 변경하지 않는다. legacy schedule은 엄격하게 파싱하고 해결 불가능한 배치는 pending으로 보존한다.
- 옛 payload는 `git show 0d5f25e8^:src/components/NextSemesterPlannerView.jsx` 형식의 `entries` **객체**다. `planner:term:<term>:<subject>:<surface>` 네 보기 저장은 독립 후보다. 화면에는 한국어 과목·보기·원본 갱신일·건수를 표시하며 자동 병합하지 않는다.
- global app_preferences 원본 값은 변경하지 않는다. sourceFingerprint는 preview 이후 수정된 원본을 감지한다. 학생 IDs/status/unknown/raw entry를 nested pending에도 넣지 않는다. 누락 과목은 `22023/timetable_import_metadata_missing`로 거절한다. 데이터가 없으면 복구했다고 주장하지 않는다. 현재 증거는 역사 source와 로컬 합성 schema/data뿐이며 실제 운영의 legacy 존재 여부는 미조사다.
- 충돌/자원 미해결/시각 오류는 pending으로 남는다. 기존 수업 목록의 `이 배치 편성`에서 같은 공용 편집 폼으로 수정한다. 선택한 pending 하나의 제거와 확정 슬롯 추가는 같은 item mutation이다. 취소하면 원본이 유지된다. 준비 수업의 en dash도 정확한 분으로 파싱하며 잘못된 시각은 whitelisted `originalSchedule`(최대 2,000자)을 pending에 보존해 편집 폼에 보여준다.

## 저장 및 오류 복구

서버에 저장된 프리셋은 브라우저를 다시 열어도 남는다. sessionStorage의 미저장·응답 미확정 복구는 **같은 탭/세션의 reload·restore** 범위다. 탭/창 종료 뒤 새로운 세션 복구를 약속하지 않는다. durable localStorage에 민감한 초안을 저장하지 않는다. [MDN sessionStorage 수명](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)을 따른다.

제출한 create/clone/rename/share/archive/restore, item, transfer, import는 원본 body/requestKey를 유지한다. 새로고침 뒤 먼저 `원래 요청 확인`/`가져오기 요청 확인`을 실행한다. metadata의 이후 입력은 원래 receipt와 별도로 보존하여 원래 요청 확인 뒤 별도 저장한다. 미제출 폼은 기존 이탈 방지를 사용한다. Storage SecurityError/용량 부족은 경고하며 서버 저장 완료로 간주하지 않는다. unknown 응답에 새 키를 발급하지 않는다. item 편집의 명시적 revision이 reload 뒤 달라져도 제출한 원래 요청은 서버 receipt까지 먼저 재시도한다. 삭제되어 화면에서 사라진 수업도 pending 요청의 복구 버튼으로 확인한다. 확정 `P0001/timetable_stale`는 `최신 내용 사용` 또는 `삭제 다시 적용`, 확정 `22023/timetable_capacity`/`timetable_invalid`와 자원 충돌은 수정·실패 요청 폐기를 제공한다. 응답이 불명확하면 원래 요청 재시도만 허용한다.

공유 해제된 교사는 다음 authorized read/focus/poll에서 열린 초안, picker 이름 및 해당 프리셋과 관련된 세션 복구 데이터만 정리하고 운영 보기로 돌아간다. 다른 허용 프리셋의 미확정 요청과 다른 actor의 세션은 유지한다. 로그아웃·actor/역할 변경은 해당 actor 전체 복구를 정리한다. 같은 항목 stale는 서버/내 입력 선택을 제공하고, 서로 다른 항목의 수정은 병합한다. 프리셋 기준 기간은 주간 수강 그림자를 비우지 않으며 날짜별 실제 점유를 추가 확인한다.

## Rollback

`NEXT_PUBLIC_TIMETABLE_PRESETS_ENABLED=false`로 다시 빌드·배포하여 프리셋 UI 진입을 숨기고 기존 운영 읽기로 복귀한다. 서버 schema, 이미 저장한 프리셋, 원본 수업, 감사 기록을 지우는 down migration은 사용하지 않는다. 이미 반영한 class는 감사 기록과 현재 상태를 대조한 **별도 복구 결정**이 필요하다. 알림 재발송이나 학생 자동 이동으로 되돌리지 않는다.

## 로컬 재현

전용 runtime 경로는 QA REPORT의 commands를 사용한다. `scripts/qa/timetable-clean-replay.py`는 `tips_timetable_20260923_replay`가 이미 존재하면 실패하며 기존 컨테이너를 stop/reset하지 않는다. PostgreSQL-only image에 필요한 auth/storage/notification fixture prerequisite를 명시적으로 적용하고 network none/no host ports로 실행한다. 이전 `.superpowers/.../bootstrap-db.py`는 기존 DB를 stop하므로 실행하지 않는다.

원본 baseline이 가진 obsolete notification trigger를 origin의 좁은 DROP/legacy write ACL 경계로 맞추지만, 오래된 notification 전체 suite를 모두 정상화하는 작업은 아니다. missing registry/content-contract join/55000 import/private ACL 제한은 QA REPORT에 남겼다. 예전 전체 migration을 다시 적용하여 최신 정의를 덮어쓰지 않는다.

최종 수정 검증은 `--container tips_timetable_finalfix_verified_20260924 --prefix final-fix-verified`로 별도 DB를 생성했다. 새 재현 때는 중복되지 않는 `tips_timetable_` 이름과 evidence prefix를 세 스크립트(clean-replay, clean-sql, final-audit)에 동일하게 전달한다. 원래 `tips_timetable_20260923`, `tips_timetable_20260923_replay` 및 수동 fixture를 reset/stop/remove하지 않는다.
