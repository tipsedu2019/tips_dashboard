# 연속 수업 일정 Release 2 운영 런북

## 기본 원칙

- runtime 0에서는 `classes.schedule_plan`이 권위 원본이다. 사용자 승인을 받은
  단일 shadow backfill만 허용하며 activate는 실행하지 않는다.
- apply는 단일 class, 정확한 source hash, UUID request key, `--apply`, class ID 재확인이 모두 있어야 한다.
- source hash는 `schedule_plan`, 기본 요일·시간(`schedule`), 선생님,
  강의실의 네 원본 값을 함께 묶는다. preview 뒤 이 중 하나라도 바뀌면
  기존 hash로 apply·verify하지 않고 새 preview와 승인을 받는다.
- apply와 verifier는 service role이 아닌 인증된 관리자 access token만 사용한다. 토큰·이름·원본 JSON을 출력하지 않는다.
- `20260729083619_continuous_class_schedule_backfill_correction.sql`이 적용되지
  않았거나 pgTAP 보정 시나리오가 실패하면 apply를 실행하지 않는다.

## 보정 마이그레이션 게이트

1. backfill RPC가 승인 payload를 `class_schedule_slots`,
   `class_lesson_sessions`에 실제로 저장하는지 확인한다.
2. cutover에 slot/session count, row hash, projection hash가 모두 기록되는지
   확인한다.
3. verify RPC가 행 drift를 `slot_payload_mismatch`,
   `session_payload_mismatch`, `projection_mismatch`로 검출하는지 확인한다.
4. runtime 0과 기존 `classes.schedule_plan` hash가 전후 동일한지 확인한다.
5. 이미 activation 이력이 있는 shadow 수업은 자동 덮어쓰지 않는다.

## Canary 절차

1. read-only preview에서 critical issue 0인 class ID 하나를 고른다.
2. class ID·count·issue code만 사용자에게 제시하고 쓰기 승인을 받는다.
3. 새 UUID request key로 정확히 한 번 apply한다.

   ```bash
   "$TASK_NODE" scripts/apply-continuous-class-schedule-backfill.mjs \
     --class-id "$CANARY_CLASS_ID" \
     --expected-source-hash "$CANARY_SOURCE_HASH" \
     --request-key "$CANARY_REQUEST_KEY" \
     --apply \
     --confirm-class-id "$CANARY_CLASS_ID"
   ```

4. 같은 class ID와 source hash로 verifier를 실행한다.

   ```bash
   "$TASK_NODE" scripts/verify-continuous-class-schedule-release-2.mjs \
     --class-id "$CANARY_CLASS_ID" \
     --expected-source-hash "$CANARY_SOURCE_HASH"
   ```

5. `matches=true`, `issueCodes=[]`, 승인 count와 실제 slot/session count 일치,
   runtime 0, 해당 수업 mode shadow를 확인한다.
6. browser에서 등록·휴보강·대시보드 parity를 확인한다. 공급자 발송은 비활성으로 유지한다.
7. 사용자 승인 뒤에만 다음 wave를 진행한다.

다음 중 하나라도 발생하면 즉시 중지한다.

- source hash stale
- 승인 count와 실제 count 불일치
- verify issue code 1개 이상
- 기존 `schedule_plan` hash 변경
- runtime 1 또는 승인하지 않은 수업의 mode 변경
- audit request key 누락

## runtime 0 rollback

1. runtime을 0으로 되돌린다.
2. 해당 class를 normalized에서 shadow로 demote한다.
3. projection·audit·consumer parity를 다시 확인한다.
4. legacy `schedule_plan`을 덮어쓰지 않는다.
