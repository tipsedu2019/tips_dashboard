# 교재 선택기 검색 요청 묶기 — 2026-10-17

교재·수업·선생님·위치 선택기의 서버 검색은 입력할 때마다 새 조회를 시작했다. 네 종류가 같은 hook과 검색 입력을 사용하므로 반복 입력의 불필요한 요청 시작을 한 곳에서 줄인다. 실제 운영 트래픽 빈도는 측정하지 않았으며, 코드상 네 선택기가 공유하는 입력 경로를 근거로 우선순위를 정했다. 별도 DB·권한·토큰·운영 데이터 변경이 없고 작은 hook/UI 연결과 합성 회귀로 검증할 수 있는 범위다.

기존 `useCommittedSearch`를 재사용한다. 입력은 즉시 보이고 조회는 입력이 250ms 멈춘 뒤 확정한다. 대기 중에는 이전 요청을 취소하고 이전 검색의 옵션·건수·facets·기본 위치·오류·acceptedInput을 노출하지 않는다. 이미 선택한 교재·수업·위치의 별도 상세 resource는 유지한다. 한글 조합 중에는 검색을 확정하지 않고 종료 시 최종 값을 사용한다. 필터·페이지·페이지 크기 조작은 현재 초안을 즉시 확정하며, 비우기는 즉시 조회한다. 대기 중 과거 retry는 이전 query를 요청하지 않는다.

사용자·권한·picker 활성 상태가 바뀌면 이전 타이머와 조합 상태를 정리하되 검색 초안은 유지한다. 기존 request generation·AbortSignal·strict RPC/wire·정렬·페이지 크기·저장 전 fresh read·mutation 경계는 유지한다. 캐시를 추가하지 않는다. 느리게 한 글자씩 입력하면 여러 조회가 발생할 수 있으며, 서버 조회 시작에는 마지막 입력 후 250ms의 의도적인 대기가 추가된다.

기준 main은 `9a9c213157b44b80b4e7c264fbbe816d0855fdb9`다. 실제 React hook과 service를 실행하고 DB transport만 deferred 메모리 응답으로 대체했다. 최초 non-empty 페이지를 수락한 뒤 `s → sy → syn → synt → synth → synthetic`을 20ms 간격으로 입력하고 마지막 입력 후 300ms를 기다렸다. 최초 페이지 요청은 아래 수에서 제외했다.

| 합성 지표 | 기준 | 변경 후 |
| --- | ---: | ---: |
| 검색 입력 | 6 | 6 |
| 입력 중 시작한 검색 RPC | 6 | 0 |
| 최종 검색 RPC 총수 | 6 | 1 |
| 취소된 검색 RPC | 5 | 0 |
| 마지막 요청 검색어 | synthetic | synthetic |

조회 시작은 83.3% 줄었다. 실제 DB 실행 횟수·서버 비용·운영 지연·브라우저 p95가 83.3% 개선됐다는 뜻은 아니다. 취소한 요청이 서버에서 이미 수행됐는지도 이 fixture로 알 수 없다.

기존 CI가 선택하는 `tests/textbook-numbered-pagination.test.mjs`에 회귀를 편입했다. 연속 입력, 이전 페이지의 늦은 응답, 네 종류 선택기, 한글 조합, 실제 CommandInput handler와 Enter 선택, 명시적 비우기/필터/페이지 크기/실패 후 retry, 사용자·StrictMode·활성/해제·unmount 타이머 경계, 선택된 위치 유지와 오래된 기본 위치 숨김을 다룬다. 실제 검색 컴포넌트와 handler를 실행하되 JSDOM이며 실제 브라우저·운영 UI 관측을 뜻하지 않는다. 기존 CI workflow는 변경하지 않는다.

재현:

    node --test --experimental-strip-types --test-concurrency=1 --test-name-pattern='^picker search' tests/textbook-numbered-pagination.test.mjs

기준 실패 로그·최종 측정·정확한 검증 head·독립 리뷰·PR·배포 승인 상태·운영 확인은 별도 실행 기록에 연결한다. PR147은 비활성 운영 관측 대기로 보존하며 이번 작업의 완료 수에 포함하지 않는다.
