## Task 9. 이관·복구·브라우저·배포 절차를 완성한다

**Files:** 신규 `docs/operations/timetable-presets-runbook.md`, `docs/qa/timetable-presets-20260923/REPORT.md`; 수정 DESIGN.md/fixture server; 필요한 capability flag와 UI 진입부.

- [ ] `개강 준비` 수업을 선택하여 새 프리셋으로 복사하는 첫 진입 흐름을 검증한다. 기존 상태/그룹 데이터 자동 변경 없이 목적 프리셋만 생성되어야 한다.
- [ ] 옛 app_preferences 키를 읽기 전용으로 조사한다. 있는 경우 key/저장 버전/수업 건수/파싱 결과만 기록하고 원본을 보존한다. 보기별 초안 내용이 다르면 별개 복구 후보로 둔다. 충돌/미해결 자원은 pending으로 가져온다.
- [ ] DB capability가 부족하거나 조회가 실패하면 현재 운영 읽기 화면은 유지하고 프리셋 편집/반영만 비활성화한다. 프리셋/그림자 DB 장애를 비어 있는 안전한 자리처럼 표시하지 않는다.
- [ ] DESIGN.md의 시간표 절에 프리셋과 기존 기간 필터가 다른 개념임을 기록한다. 공용 토큰 변경이 있으면 해당 공용 구현과 다른 소비 화면도 같은 변경에서 검증한다.
- [ ] 회귀 묶음 실행: `tests/timetable-layout.test.mjs`, `tests/timetable-image-export.test.mjs`, `tests/academic-scoped-reads.test.mjs`, `tests/management-continuous-class-schedule.test.mjs`, `tests/continuous-class-schedule-release2-service.test.mjs`, 새 timetable 테스트. 현재 CI의 `Verify shared dashboard design contracts`도 실행한다.
- [ ] TypeScript, 변경 파일 ESLint, 배포용 build를 실행한다. 기존 실패가 있으면 비교 증거와 영향 경계를 기록하고 신규 실패를 기존 문제로 넘기지 않는다.

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/features/academic src/features/management/management-service.js
pnpm build
```

- [ ] 브라우저 2세션에서 저장/동시 수정/재접속/초안 복구, 네 보기 전체 이동, 전체/일부 transfer, 빈 상태·초기 조회 실패·stale scope·모바일 touch/scroll·키보드 폼·Escape/초점 복귀를 확인한다. 개인정보 없는 합성 화면을 QA REPORT에 연결한다.
- [ ] runbook에 schema→backfill 없음→권한/최종 함수 검사→capability→UI 배포→운영 읽기 smoke 순서를 적는다. 운영 DB 데이터 변경/이관은 승인된 선택만 실행하며 이 계획 작성 중에는 수행하지 않는다.
- [ ] rollback은 UI capability off와 읽기 전용 복귀다. 이미 만들어진 프리셋/운영 수업/이력을 지우는 down migration은 하지 않는다. 반영한 class는 감사 기록과 현재 상태를 비교하여 별도 복구한다.
- [ ] 최종 보고에 다음을 각각 기록한다: 코드, 단위/계약 테스트, 로컬 pgTAP, 두 연결 경쟁, 브라우저, main CI, 운영 migration, 배포, 실제 운영 수업 전환. 미실행 항목을 완료로 표시하지 않는다.
- [ ] 통과 후 커밋: `docs: finish timetable preset rollout and verification evidence`.

## C. 요구사항 추적

| 사용자 요구 | 구현 task | 최종 판정 |
| --- | --- | --- |
| 다음/다음다음/그 이후 학기 저장 | 3, 5, 6 | 독립 프리셋 3개 생성·재접속·서로 불변 |
| 네 보기 어느 곳에서나 직접 배치 | 2, 6 | 4×신규 drop/이동, 같은 stable ID |
| 입력으로 자동 셀 배치 | 2, 6 | 복수 요일 폼 저장 및 빈 시간 후보 |
| 배치한 수업 드래그 이동 | 2, 5, 6 | 시간 길이/다른 자원/다른 요일 보존 |
| 선생님/강의실 충돌 방지 | 3, 4, 8 | UI·DB·다른 쓰기 경로·두 연결 경쟁 |
| 여러 수업 또는 일부 수강으로 올리기 | 7, 8 | copy/move × 1/일부/전체, 전부 rollback |
| 현재 수강 수업의 자리 비워 두기(후속 설명) | 2–8 | 네 보기의 읽기 전용 그림자, 같은 교사/방 점유 차단, 실제 수강 불변 |
| 같이 편성·저장 | 3, 5, 8 | 역할/공유, 서로 다른 수정 병합, 같은 수정 stale |
| 기존 기능보다 개선 | 1–9 | 실패 무시 제거, stable ID, 빈 보드, 시간 정확도, DB 원자성 |

## D. 문서 자체 검토

- [x] 사용자 요구를 C절에 모두 연결했다.
- [x] 기준 checkout과 최신 저장된 원격 ref 차이를 명시했다.
- [x] 사라진 구현의 복원 범위와 재사용하지 않을 저장/적용 구조를 구분했다.
- [x] 기본 시간표와 이미 생성한 회차, 운영 그림자와 편집 초안, 복사/이동 결과의 의미를 구분했다.
- [x] API/모델/화면 task별 책임, 입력·기대 결과·명령·중단 조건을 명시했다.
- [x] 실제 데이터 migration·외부 알림·운영 배포를 계획 작성 완료와 구분했다.

사용자의 두 후속 답변(운영 그림자, 요일·시간 배치+빈 시간 추천)을 반영했다. 교사 공유 범위 등 추가 설계 선택은 spec의 제안이다. 구현 방법은 작업 난도와 병렬 가능성에 맞게 조정할 수 있으며 이 문서 작성으로 구현을 시작하지 않는다.
