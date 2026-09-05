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

## Vercel DESIGN.md 브랜드 보고서

[getdesign.md의 Vercel 분석](https://getdesign.md/vercel/design-md)은 Vercel의 공식 지침이 아니라 공개 화면을 바탕으로 한 독립 분석이라고 스스로 밝힌다. 페이지에서 revision 또는 재사용 license를 확인할 수 없으므로 원문, 색·폰트 수치, 로고·자산은 복제하지 않는다.

재사용하는 것은 평가 방식뿐이다. 제품의 실제 목적과 사용자를 먼저 적고, 현재 코드에서 색·타입·간격·컴포넌트·상태를 관찰하며, 유지할 것과 피할 것을 명시하고, 구현 뒤 실제 화면으로 문서와의 차이를 다시 확인한다. Vercel의 흑백 브랜드, Geist, 마케팅 리듬은 TIPS 디자인 기준이 아니다.

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
