# Quality Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this bounded documentation task. The controller separately gathers browser and code evidence for the pilot fixes.

**Goal:** 공식 지침을 출처와 조건이 명확한 프로젝트 품질 기준으로 연결한다.

**Architecture:** 기존 AGENTS.md에 진입점을 추가하고 짧은 프로젝트 스킬에서 디자인/성능/DB 검토 자료를 필요할 때 읽도록 연결한다. upstream 원문을 대량 복사하거나 플러그인을 중복 설치하지 않는다.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, Tailwind 4, shadcn/Radix, Supabase, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-quality-foundation.md`

## Global Constraints

- 기존 AGENTS.md의 디자인·업무·권한·SQLSTATE·no-send 규칙을 보존한다.
- main 반영, push, 운영 배포, 운영 DB 적용, 실제 메시지 발송은 이번 범위에 포함하지 않는다.
- 공식 문서는 참고 자료이며 사용자 지시·프로젝트 정책·실제 설치 버전보다 우선하지 않는다.
- 변경은 이 격리 worktree 안에서만 수행한다. 애플리케이션 소스, package.json, CI와 전역 플러그인/메모리 폴더를 변경하지 않는다.

### Task 1: 공식 출처와 작업별 품질 지침 연결

**Files:**
- Create: `DESIGN.md`
- Create: `.agents/skills/tips-quality/SKILL.md`
- Create: `docs/agents/quality-sources.md`
- Modify: `AGENTS.md` (관련 지침 링크와 읽는 시점만 추가)

**Interfaces:** 기존 AGENTS.md, components.json, src/app/globals.css 및 설치된 스킬을 읽는다. 출력은 변경할 업무 흐름별 참고 자료와 검증 계약이며 애플리케이션 API는 바꾸지 않는다.

- [x] 공식 Vercel web-interface-guidelines 및 react-best-practices, shadcn/ui 스킬, Supabase 스킬, Anthropic frontend-design의 실제 원문과 upstream 라이선스·revision을 확인한다. 링크와 조회일, 설치본 경로/버전과의 차이를 quality-sources.md에 기록한다. Vercel design.md는 브랜드 보고서에만 맞는 부분과 재사용할 평가 방식을 구분한다.
- [x] DESIGN.md에 TIPS 목적·업무 우선순위·기존 Pretendard/semantic color tokens·공통 UI의 위치·밀도/모바일/키보드/폼/로딩/오류 기준을 간결하게 작성한다. 10/15/20행과 10페이지 단위의 관리 목록 계약은 실제 현재 코드/테스트를 확인하고 기록한다. 숫자 기준은 외부 권고인지 프로젝트 기준인지 명시한다.
- [x] tips-quality/SKILL.md를 100줄 이내로 작성한다. UI 작업은 DESIGN.md와 실제 컴포넌트, React 성능 작업은 측정 후 Vercel 관련 참조, DB 작업은 Supabase 지침과 최종 마이그레이션/pgTAP, 지침 갱신은 quality-sources.md를 읽게 한다. 이미 제공되는 스킬이 있으면 그것을 사용하고 없으면 canonical 링크를 읽는 경로를 제공한다. 일반적인 소규모 수정에 추가 승인/테스트/서브에이전트 절차를 강제하지 않는다.
- [x] AGENTS.md에 짧은 품질 지침 진입점을 추가한다. 기존 규칙을 원문 그대로 보존한다.
- [x] 새 스킬을 skill-creator의 quick_validate.py로 검증하고 모든 상대 문서 링크가 존재하는지 확인한다. git diff --check를 실행한다. 문서 변경에 불필요한 앱 전체 테스트를 추가하지 않는다.
- [x] diff를 자체 검토하고 지정 파일만 커밋한다. 보고서에 출처·중복/충돌 해결·검증 결과·커밋을 남긴다.
