# 품질 지침 출처와 채택 기록

조회일: 2026-09-05 (Asia/Seoul)

이 문서는 외부 지침의 출처, 설치본 차이, TIPS에서의 적용 경계를 기록한다. 외부 원문을 저장소에 복제하지 않으며, 지침을 갱신할 때 revision과 license를 다시 확인한다. 공식 문서도 사용자 지시, `AGENTS.md`, 실제 업무 계약과 설치된 코드보다 우선하지 않는다. 아래 설치 경로는 모두 `/Users/hyunjun/.codex/plugins/cache/openai-curated-remote/` 아래의 상대 경로다.

## 확인한 원문

| 자료 | 확인한 revision과 license | 설치 상태 | TIPS 적용 |
| --- | --- | --- | --- |
| Vercel Web Interface Guidelines | [`command.md` @ `e3d624b`](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md), [`README.md` @ `51af38a`](https://github.com/vercel-labs/web-interface-guidelines/blob/51af38ae05cb72533cd591a1fd46325a8903baa0/README.md). 저장소의 [`LICENSE`](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/LICENSE)는 MIT, Copyright 2025 Vercel Labs. | 지정된 플러그인 캐시에는 `web-design-guidelines`가 없다. Vercel agent skill은 [`ba46938`](https://github.com/vercel-labs/agent-skills/blob/ba46938889d4e58635362fb8f618e1178ac3ec46/skills/web-design-guidelines/SKILL.md)에서 매 검토 시 최신 `command.md`를 읽도록 라우팅한다. | 키보드, 포커스, 의미 요소, 비동기 알림, 폼, 복구 가능한 오류, 반응형 상태를 점검한다. `Vercel-specific` 문구·브랜드 선택과 외부의 성능 수치는 TIPS 계약으로 자동 채택하지 않는다. |
| Vercel React Best Practices | [`SKILL.md` @ `805687f`](https://github.com/vercel-labs/agent-skills/blob/805687f34e8c10b420e3d11335a0ca2c3c90d992/skills/react-best-practices/SKILL.md). 저장소에는 license 파일과 GitHub 감지 license가 없고, [`README.md` @ `9da6e5a`](https://github.com/vercel-labs/agent-skills/blob/9da6e5ad92e7fd7292b779abf076bf5dbad783ac/README.md#license)가 MIT라고 선언한다. | `vercel/0.21.4/skills/react-best-practices`와 `build-web-apps/0.1.2/skills/react-best-practices`가 있다. 둘 다 upstream 최신 원문과 byte-identical하지 않다. Vercel 설치본은 선택 트리거를 좁히고 upstream의 최근 6개 규칙을 포함하지 않은 64-rule 판본이며, build-web-apps 판본 metadata는 `1.0.0`이다. | waterfall, bundle, server/client fetch, rerender 검토에 사용하되 실제 측정 뒤 관련 규칙만 읽는다. 대규모 리팩터링이나 새 의존성을 규칙 자체로 정당화하지 않는다. |
| shadcn/ui skill | 공식 shadcn/ui의 [`SKILL.md` @ `6cd3f4c`](https://github.com/shadcn-ui/ui/blob/6cd3f4c65c361ab6554e06a77e6a0af9cf8b6e37/skills/shadcn/SKILL.md). [`LICENSE.md`](https://github.com/shadcn-ui/ui/blob/6cd3f4c65c361ab6554e06a77e6a0af9cf8b6e37/LICENSE.md)는 MIT, Copyright 2023 shadcn. | `vercel/0.21.4/skills/shadcn`과 `build-web-apps/0.1.2/skills/shadcn-best-practices`가 있으며 공식 revision과 byte-identical하지 않다. 실제 프로젝트는 `components.json`의 `new-york`, `rsc: false`, CSS variables, neutral base, Lucide와 현재 `src/components/ui/`를 사용한다. | 기존 컴포넌트 구성, semantic token, 접근성 구조를 우선한다. 공식 스킬의 최신 CLI·Field·Base UI 예는 현재 소스와 일치하는지 확인한 뒤 적용하며 자동 init, overwrite, preset, Radix/Base migration은 하지 않는다. |
| Supabase agent skills | 일반 Supabase [`SKILL.md` @ `3a4f0ce`](https://github.com/supabase/agent-skills/blob/3a4f0ce0782e0cbdcf187c362e8d15d9e324462b/skills/supabase/SKILL.md), Postgres [`SKILL.md` @ `3291216`](https://github.com/supabase/agent-skills/blob/32912161e2732c3e5001c6811a76c1f8308ed0da/skills/supabase-postgres-best-practices/SKILL.md). 두 revision에서 저장소 [`LICENSE`](https://github.com/supabase/agent-skills/blob/3a4f0ce0782e0cbdcf187c362e8d15d9e324462b/LICENSE)는 MIT, Copyright 2026 Supabase. | `supabase/1.0.0/skills/supabase` metadata `0.1.2`, `supabase-postgres-best-practices` metadata `1.1.1`이 있고 둘 다 해당 upstream revision과 byte-identical하지 않다. `build-web-apps/0.1.2`에도 Postgres `1.1.0` 판본이 중복된다. | 세션에 제공된 `supabase:` 스킬을 우선 쓴다. upstream의 직접 SQL 반복·migration 생성 절차보다 이 저장소의 ordered migration, 최종 함수 정의, pgTAP, RLS/ACL, 정확한 SQLSTATE, no-send 규칙이 우선한다. 운영 DB 적용은 별도 증거와 권한이다. |
| Anthropic frontend-design | [`SKILL.md` @ `41bbe19`](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md), 같은 revision의 [`LICENSE.txt`](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/LICENSE.txt)는 Apache License 2.0. | 지정된 설치 캐시에 frontend-design skill은 없다. | 새 시각 방향이 필요한 화면에서 실제 주제에 맞는 계획, 구현 뒤 스크린샷 자기비평, 불필요한 장식 제거 방식을 참고한다. Pretendard, 기존 semantic token, 업무 밀도를 버리거나 모든 운영 화면을 마케팅 페이지처럼 만드는 근거로 쓰지 않는다. |

## Vercel 공식 design.md와 평가 방법

Vercel은 2026-08-31 게시한 [공식 블로그](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md)에서 [공개 `design.md`](https://vercel.com/design.md)를 Vercel 코드베이스 밖에서 만드는 보고서·제안서·brief 등에도 Vercel 저작물처럼 보이게 하는 단일 브랜드 지침으로 설명한다. 원문은 `official Vercel-authored report website`를 범위로 정하고, Vercel wordmark와 triangle logo, Geist, [`vercel-brand.css`](https://vercel.com/geist/vercel-brand.css)의 공개 API를 요구한다. 이는 TIPS 운영 제품의 디자인 권한이 아니다. TIPS에는 Vercel 로고·Geist·VBG class/token·브랜드 stylesheet를 적용하지 않고 기존 Pretendard, semantic token, 업무 컴포넌트를 유지한다.

공식 블로그에서 재사용하는 것은 개선 방법이다. 실제 독자와 입력으로 고정 시나리오를 만들고, prompt·data·model·viewport를 같게 둔 baseline과 변경본을 비교한다. 수용한 피드백은 판단이면 문서, 반복 mechanics면 컴포넌트·token, 기계적으로 검출 가능한 실패면 코드 검사·테스트의 가장 좁은 위치에 둔다. 변경 뒤 영향받은 시나리오를 다시 실행하고, 실제 사용에서 같은 지적이 줄어드는지 본다. 이 방법은 TIPS의 UI 구조나 브랜드 값을 Vercel처럼 바꾸라는 뜻이 아니다.

공개 revision과 license에는 한계가 있다. 2026-09-05 조회 시 `design.md` 응답은 `text/markdown`, canonical `https://vercel.com/design`, 본문 SHA-256 `2b40b23712e548721ecae7d0672ae9318a83188b9fcd2fb4a7a1b7c147a39903`이었지만 commit/revision, `ETag`, `Last-Modified`, license 표시는 없었다. 블로그에는 게시일만 있고 content revision이나 별도 재사용 license가 없다. stylesheet는 `text/css`, `ETag: 7d92214615491e239384bbe5bb3501fc`, `Last-Modified: Sat, 05 Sep 2026 06:26:18 GMT`였지만 별도 license를 확인하지 못했다. 이 값들은 조회 snapshot의 식별자이지 영구 upstream revision이나 재사용 허가가 아니다. 따라서 원문과 브랜드 자산은 복제하지 않고 공식 URL을 범위에 맞을 때만 다시 읽는다.

## 중복과 충돌 해결

- `vercel/0.21.4`, `build-web-apps/0.1.2`, `supabase/1.0.0`, `superpowers/6.3.0`은 전역 설치본으로 유지하고 저장소에 복사하지 않는다. 세션에서 제공되는 전문 스킬이 있으면 그것을 사용하고, 없을 때 위 revisioned canonical 링크를 읽는다.
- React와 shadcn 중복본 가운데 TIPS router는 더 구체적으로 제공된 `vercel:` 스킬을 가리킨다. Supabase는 공급자 전용 `supabase:` 스킬을 가리킨다. `superpowers` workflow 스킬은 구현 절차가 실제로 필요한 경우에만 별도로 적용한다.
- 외부 지침의 일괄 규칙이 현재 shadcn 소스, 폼 구성, migration 방식과 충돌하면 현재 구현을 먼저 확인한다. 바꿀 이유와 검증 범위가 있는 작업에서만 이동한다.
- 외부 수치 가운데 24px/44px hit target, 16px mobile input, 로딩 지연, 500ms mutation 같은 값은 점검용 권고다. TIPS의 `10/15/20`행, 기본 10행, 10페이지 묶음만 현재 코드·테스트가 고정한 프로젝트 수치다.

## 갱신 절차

1. 이 문서의 canonical URL에서 실제 원문, 마지막 해당-file commit, license를 다시 확인한다.
2. 설치 경로와 metadata version, 관련 원문의 차이를 확인한다.
3. 실제 `components.json`, `src/app/globals.css`, 공통 컴포넌트, 최종 migration과 테스트가 여전히 같은 계약인지 확인한다.
4. 바뀐 규칙 중 TIPS 판단을 실제로 개선하는 부분만 요약하고 채택·보류 이유를 남긴다.
