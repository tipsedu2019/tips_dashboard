# 운영 안전성과 알림 구현 기준선

기록일: 2026-07-16 (Asia/Seoul)

상태: **SUPABASE 플러그인을 사용해 작업 1 진행 가능**

이 문서는 직접 확인한 사실만 기록합니다. 연결된 Supabase 변경, 외부 발송 요청, 푸시, 배포는 수행하지 않았습니다.

## 저장소와 작업 트리 식별 정보

- 기준 계획 커밋: `0f0d1b2590118cf8bb111069ffd4a1a87f178bf1`
- 구현 브랜치: `codex/operational-safety-notification-completion`
- 구현 작업 트리: `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/operational-safety-notification-completion`
- `origin/main`: `b212d43474ca96fbedb415034089ada559b3e724`
- 계획 전용 커밋 뒤 시작 시점은 `origin/main`보다 8개 커밋 앞선 상태였습니다.
- 루트 checkout에는 계획 커밋 전에 추적되지 않은 마스터 계획 파일만 있었습니다. 작업 1과 겹치는 사용자 애플리케이션 코드 변경은 없었습니다.
- 기존 작업 트리는 모두 확인하고 보존했습니다.
  - `/Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/codex-makeup-requests`
  - `/Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/public-classes-sanitized`
  - `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/registration-intake-routing`

## 예정 파일과 마이그레이션 목록

- 예정된 소스·마이그레이션·테스트 경로에는 `notification-control-plane`, `registration-appointment-calendar`, `registration-history-timeline`, `registration-appointment-reminders`에 해당하는 파일이 없었습니다.
- 당시 가장 최신 로컬 마이그레이션 파일은 `20260714104301_textbook_taxonomy_arrays.sql`이었습니다.
- 마스터 계획에 미리 정한 모든 timestamp는 로컬 마이그레이션 파일 목록에서 비어 있었습니다.
- Supabase 플러그인으로 마이그레이션 목록을 읽기 전용 조회했고, 로컬과 동일하게 `20260714104301_textbook_taxonomy_arrays`까지 일치했습니다.

## 테스트와 정적 검사 기준선

| 검사 | 결과 |
| --- | --- |
| 집중 Node 기준선 | 통과 — 140/140 |
| 전체 Node 기준선 | 통과 — 1012/1012 |
| `pnpm exec tsc --noEmit` | 통과 |
| `pnpm run lint` | 통과. 500KB를 넘는 작업 파일 2개에 대한 기존 Babel 최적화 생략 안내만 출력 |
| `git diff --check` | 통과, 출력 없음 |

격리 작업 트리의 의존성 디렉터리는 처음에 복구가 필요했습니다. bundled fallback pnpm이 추적되지 않은 빌드 정책 placeholder를 만들고 `node_modules`를 불완전하게 남겼기 때문입니다. lockfile이 같은 루트 checkout의 `node_modules`를 작업 트리에서 사용하도록 복구한 뒤 타입 검사, lint, diff 검사를 다시 실행해 통과했습니다. 의존성 manifest와 lockfile은 바꾸지 않았습니다.

## Supabase 플러그인 데이터베이스 확인

연결된 Supabase 플러그인은 PostgreSQL 17을 사용하는 정상 상태의 `tips dashboard` 프로젝트를 확인했습니다. 마이그레이션은 로컬 최신과 같은 `20260714104301_textbook_taxonomy_arrays`까지 적용돼 있었고, `registration_subject_tracks_runtime_version()`과 `registration_intake_workflow_runtime_version()`은 모두 1을 반환했습니다.

Docker와 로컬 pgTAP은 사용할 수 없지만 구현 선행 조건으로 두지 않습니다. 현재 DB 상태는 플러그인 읽기 조회로 확인하고, 새 DB 코드는 저장소의 마이그레이션·스키마·서비스 테스트로 검증합니다.

- 플러그인 마이그레이션 목록: 통과
- 과목 트랙 런타임 마커: 통과 — 버전 1
- 접수 업무 런타임 마커: 통과 — 버전 1
- 기존 공개 원자적 생성 wrapper 정의: 확인 완료

## 브라우저 서버 상태

초기에는 `127.0.0.1:3001`에서 PID `71994`, 올바른 구현 작업 트리 CWD와 시작 HEAD를 확인했습니다. 의존성 복구 과정에서 이 프로세스는 무효화됐습니다. 독립 검토 중에는 PID `74329`가 같은 포트에서 잠시 실행됐지만, 최종 확인 시 종료돼 있었습니다. 이 두 프로세스는 현재 QA 증거로 사용하지 않았습니다.

2026-07-17에는 같은 구현 작업 트리에서 Next.js Webpack 개발 서버를 다시 `http://localhost:3001`에 실행했고 `/admin/registration` HTTP 200을 확인했습니다. 이 서버는 현재 중간 결과 확인용이며, 인증된 저장·재열기 증거는 별도 브라우저 검증으로 남깁니다.

Google Chat, Web Push, SOLAPI 요청은 시도하지 않았습니다. 화면 상호작용 QA는 결정론적 fixture를 사용하고, 최신 데이터베이스 마이그레이션·런타임 사실은 Supabase 플러그인으로 확인합니다.

## 다음 단계

Supabase 플러그인으로 현재 DB 사실을 확인하고, 프런트엔드 상호작용은 결정론적 fixture로 검증하면서 계획의 다음 태스크를 순서대로 계속 진행합니다.
