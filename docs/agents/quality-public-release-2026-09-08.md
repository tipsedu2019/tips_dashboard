# 공개 수업 운영 전환 — 2026-09-08

## 릴리스 범위

공개 저장소는 학원 소개·후기·성과를 제공하고, 대시보드 `/classes`가 익명 수업 검색·실제 달력·교재 진도·개인 시간표를 제공한다. 공개 도메인의 rewrite로 두 배포를 연결한다.

대시보드 릴리스 기준은 `origin/main`의 `e29cd855`다. 기존 검토 브랜치의 Q14 공개 데이터 변경 12개 파일과 공개 수업 리뉴얼 7개 커밋을 분리하여 적용했다. 코드 HEAD `aa04f341`의 변경 파일 33개는 최종 검토를 통과한 `be734267`의 해당 파일과 모두 동일하다. SQL, 등록·알림 모듈, workflow, dependencies에는 변경이 없다. 기존 Q11–Q16의 나머지 로컬 작업은 원래 검토 브랜치에 보존한다.

공개 저장소 릴리스는 `5c3d761..a419f4f`다. 원래 공개 checkout의 미커밋 변경 14개는 독립 worktree 사용으로 보존했다.

## 배포 전 확인

- 대시보드 공개 수업 관련 검사 59개 통과, skipped 0.
- webpack production build 및 TypeScript 통과.
- 관련 ESLint 오류 0. 기존 변경하지 않은 `public-classes-cache.integration.test.mjs`의 사용하지 않는 `mkdtemp` 경고 1개는 별도다.
- 공개 저장소 deploy-ready 감사 7개 통과.
- 운영 Supabase migration 285개와 이 릴리스의 migration 285개를 읽기 전용으로 대조해 미적용 항목 0개를 확인했다. 이 릴리스는 새 migration을 포함하지 않는다.
- 최종 독립 검토에서 발견했던 Next stale-cache의 공개 해제 수업 재노출 문제는 실 Next App Router cache 회귀 검사와 수정분 재검토를 통과했다. 모든 공개 수업 구현 파일이 해당 검토 결과와 동일함을 다시 확인했다.

이 항목은 배포 전 검증이다. 원격 CI, Production 배포 및 실제 공개 도메인 검증은 PR과 배포 영수증에서 별도로 확인한다.

### 원격 쿼리 보호 검사 후 수정

PR #39의 첫 CI에서 상세 조회의 imported projection·공유 실행 helper를 정적으로 판독하지 못했고, 진도·교재 조회에 명시적인 정렬·페이지 제한이 없음을 발견했다. 검사나 예외 목록을 변경하지 않고 조회를 수정했다.

- 한 수업만 exact-ID로 읽고, 진도는 `id` 순서로 30건씩 keyset 조회한다. 교재는 중복을 제거한 관련 ID를 30개씩 묶는다.
- 모든 페이지가 최초 조회의 8초 제한을 공유하며 재시도하지 않는다. 후속 페이지 실패·시간 초과는 부분 결과를 반환하거나 캐시하지 않는다.
- projection은 함수 안에서 확인할 수 있도록 명시하며 기존 공개 projection과의 일치를 검사한다. 응답 정리와 Next cache 정책은 유지한다.
- 1,005건 진도·65개 교재, 후속 페이지 실패, 공통 deadline 회귀 검사 3개를 추가했다. 수정 전 3개 실패를 확인한 뒤 공개 검사 총 62개 통과와 free-tier guard 통과를 확인했다.

이 후속 수정은 최초 33개 파일 동등성 확인 이후 적용되었으며, 위 동등성 증거와 별도로 검증한다.

## 전환 순서와 복구 기준

대시보드의 공개 응답 정리는 기존 퍼블릭 수업 번들과 호환되지 않으므로 공개 저장소를 먼저 전환한다. 양쪽 PR·preview·검증을 준비한 뒤, 공개 저장소를 반영하여 현재 동작하는 기본 dashboard `/classes`로 연결하고, 이어 갱신된 대시보드를 반영한다. 중간에는 기본 수업 UI가 잠시 표시될 수 있다.

전환 전 Production 복구 지점:

- 공개 프로젝트 `tips-dashboard-public-router`: `dpl_9uUbXe8oWfV4mnCgSLQufWaTcz7s`.
- 대시보드 프로젝트 `tips_dashboard`: `dpl_2ikcuKMgwtSbR9AZyJG57KV5j93f`.

공개 셸만 복구할 때 이전 전체 응답을 요구하는 번들이 돌아오면 대시보드도 호환 배포로 함께 복구해야 한다. 대시보드만 복구할 때는 공개 rewrite를 유지할 수 있다.

## 유지할 외부 라우팅

퍼블릭 Vercel 프로젝트 `prj_15SCW6TdhxGm1eBq2CpgTa5nks13`의 project-level rule은 저장소 배포와 독립적이다.

- id `c75081bc-6ad2-4c6d-932d-73fe2e79b6bb`
- name `Rewrite test-gen to tips domain`
- enabled `true`
- source `/test-gen(/.*)?`
- destination `https://tips-test-gen.vercel.app/test-gen$1`

배포 전 동일한 규칙을 읽기 전용으로 확인했다. 규칙을 변경하거나 저장소에 중복하지 않는다. 공개 저장소의 `DEPLOYMENT_ROUTING.md`에 전환·복구 절차가 있다.

## 운영 확인 항목

각 저장소의 main/CI/Production 상태를 별도로 확인하고, 공개 도메인에서 홈·후기·성과·영어 필터 수업·수업 상세·실제 Next static asset·퇴역 JSON 404를 확인한다. 익명 관리 진입의 로그인 이동과 `/test-gen` 진입·sign-in·health·실제 static asset도 확인한다. 상세 성공의 600초 캐시와 실패의 no-store를 확인하며, 운영 데이터의 강제 변경이나 실제 알림 발송으로 시험하지 않는다.

근거: [Vercel promotion](https://vercel.com/docs/deployments/promoting-a-deployment), [Project Routing Rules](https://vercel.com/docs/routing/project-routing-rules). Production artifact와 실제 응답을 확인한 뒤 전환 완료를 보고한다.
