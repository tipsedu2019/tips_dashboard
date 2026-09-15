# T19 통계 URL 상태와 T17–T19 브라우저 확인

통계 화면은 Next useSearchParams를 단일 입력으로 사용한다. 학생·수업 탭의 subject=all|english|math|science, division=all|middle|high를 복원한다. overview는 표시되지 않는 학생 필터를 제거한다. 충돌/교재는 학생 필터를 제거하고 기존 탭별 range presets만 허용한다. 기본값, invalid/duplicate/unknown query를 정규화하고 URL에서도 제거한다. 선택 탭만 mount하므로 최초부터 4개 요청을 보내지 않는다.

탭 선택은 기존 requestAppNavigation을 거쳐 pushState, 같은 탭 필터는 replaceState다. Next history 동기화를 위해 null state를 전달한다. 뒤로/앞으로 이동은 이전 탭의 필터 문맥을 복원한다. 탭을 새로 선택하면 그 탭의 기본 필터로 시작한다. URL query와 API query/auth/cache 계약은 분리되어 있으며 API/cache/backend 변경은 없다.

## 자동 검사

`node --test tests/statistics-*.test.mjs tests/dashboard-metrics.test.mjs`: 73개 통과.

- parser: deep link roundtrip, default/invalid/duplicate/unknown, tab별 전체 presets, 학생 필터 유입 방지.
- JSDOM: deep link 최초 활성탭 단일 mount, 필터 replace/history length 불변, 탭 push, back/forward 필터 복원 및 focus 유지.
- 실제 hook fetch: accepted result→refresh→500 보존, 다른 subject/role/logout 즉시 데이터 제거.
- focused ESLint: 수정된 통계 source 5개 오류 없음.

## 실제 앱 브라우저

대상: http://127.0.0.1:3216/admin/statistics, Chromium, light, 1440×900와 390×900. API/Supabase 전부 합성 응답으로 가로채고 외부 요청 차단 및 WebSocket 차단. 운영 데이터/DB/provider writes 없음.

두 너비 모두 다음 흐름 통과: 영어·고등부 deep link, 최초 student tab 요청만, 50개 긴 학교명에서 top8→모두보기, 막대 키보드 Enter→기존 명단 exact school-id-0/english/high query, 동일 key 갱신중 및 500에서 42명 보존, 수학 전환 17명 및 버튼 focus 유지, 교재 탭 학생필터 제거, 30일 URL, back/forward, reload, invalid 충돌365일→기본90일 정규화. pageerror 0, 미정의 API 요청 0, 페이지 가로 overflow 0.

스크린샷은 직접 검토했다. 긴 학교명은 전체 줄바꿈되고 수치와 막대가 표시된다. 교재는 종/개/건으로 분리된다. 아티팩트: `/tmp/tips-premium-dashboard-20260915/statistics/results.json`, `{1440,390}-students.png`, `{1440,390}-refresh-error.png`, `{1440,390}-textbooks.png`. 실행 harness: `/tmp/premium-statistics-qa.mjs` (repo QA 공통 harness 무수정).

현재 브라우저 검증은 합성 fixture다. production build/restart/deploy는 이 카드에서 실행하지 않았다.
