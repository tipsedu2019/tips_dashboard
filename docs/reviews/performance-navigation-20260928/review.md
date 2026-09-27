# 메뉴 사전 로딩 성능 개선

## 발견한 문제

운영 `360887b9914d36b656b7329f53efea4275dbd4c9`에서 로그인한 관리자가 대시보드만 열어도 보이는 사이드바 메뉴와 일정 바로가기가 다른 메뉴를 자동 사전 로딩했다. `NavMain`에는 이미 포인터 진입과 키보드 초점에 따른 `router.prefetch`가 있었지만, Next Link의 기본 viewport prefetch가 함께 동작하고 있었다.

- 조건: Chrome, `/admin/dashboard`, 1440×900, HTTP 캐시 비활성화, 메뉴 조작 없는 새로고침.
- 앱 JavaScript: **59건, 919,094 encoded bytes**.
- RSC 사전 로딩: **13개 경로에 53건, 40,847 encoded bytes**.
- 현재 대시보드 외 admin 페이지 진입 chunk: **11개**.
- CDP 기록 잘림 없음. `/manifest.webmanifest` 404 두 건은 변경 전부터 존재했다.

원본 집계는 [production-before.json](./production-before.json)에 있다. encoded bytes에는 응답 오버헤드가 포함되며 확장 프로그램의 스크립트는 제외했다. 이 수치는 다운로드량이며 DB 호출 수, API p95 또는 사용자 체감 시간의 개선율이 아니다.

## 적용

- 사이드바의 상위·하위·일반 메뉴 링크에 `prefetch={false}`를 적용하고 기존 포인터·초점 사전 로딩은 유지한다.
- 로고와 대시보드 일정 바로가기는 선택할 때 경로를 로딩한다. 기존에 false였던 집계·업무 상세 링크와 일관되게 맞춘다.
- 링크 의미, 목적지와 쿼리, 새 탭 열기, 현재 메뉴 선택 시 모바일 닫기, 미저장 변경 보호, 권한·데이터 계약을 바꾸지 않는다.
- 공유 동작 기준을 `DESIGN.md`에 명시한다. 디자인 토큰·레이아웃·시각 스타일 변경은 없다.

[Next Link 문서](https://nextjs.org/docs/app/api-reference/components/link#prefetch)와 설치된 Next 16.1.1의 `next/dist/client/app-dir/link.js`에서 `prefetch={false}`가 자동 사전 로딩을 끄는 조건임을 확인했다.

## 배포 전 검증

- 관련 기존 테스트 **64/64 통과**: admin shell, sidebar brand/focus return, command search, dashboard daily brief/interaction.
- Next 전용 `prefetch` 속성을 DOM에 넘기던 테스트 mock 수정 후 sidebar focus return **11/11 재통과**, 해당 테스트 ESLint 통과.
- 변경 TSX ESLint, `git diff --check`, 운영 환경 production build 통과.
- 별도 합성 Supabase transport로 production build/Next start를 실행했다. 실제 운영 데이터 호출을 전달하지 않는 기존 `dashboard-workload-fixture-server.mjs`를 사용했다.
- 1440×900, 캐시 비활성화, 새로고침 후: **앱 JS 21건, RSC 사전 로딩 0건, HTTP 오류 0건**, CDP 기록 잘림 없음.
- 등록 메뉴 포인터 진입: 등록 경로만 RSC 사전 로딩 **6건**, 모두 200. 이후 Tab으로 전반 메뉴에 초점 이동: 전반 경로만 **4건**, 모두 200.
- 데스크톱의 기존 대시보드/사이드바/초점 표시를 확인했다. 모바일 390×844에서 메뉴 열기, Escape 후 열기 버튼으로 초점 복귀, 현재 대시보드 메뉴 선택 후 닫힘을 확인했다. 문서 너비는 viewport를 넘지 않는다.

로컬 fixture의 압축·환경 차이가 있으므로 전후 바이트 비교는 동일한 운영 환경에서 배포 후 다시 측정한다. 목적지의 실제 데이터 로딩과 운영 화면 탐색도 배포 후 별도로 확인한다. 운영 데이터 저장·알림 발송은 검증 범위에 없다.

## 다음 검증

PR 필수 CI와 배포 상태를 확인한 뒤 운영 대시보드에서 같은 조건으로 측정한다. 유효한 초기 다운로드 감소, 메뉴 탐색, 모바일 초점 복귀가 확인되면 이 개선을 완료한다. 운영 API p95나 간헐적 지연 전체의 해결을 의미하지 않는다.
