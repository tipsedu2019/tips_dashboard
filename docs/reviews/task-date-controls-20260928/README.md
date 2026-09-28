# 업무 목록 날짜 입력 코드 지연 로딩

- 기준: main `8c5881e7b2eb646eeaae2f2bb737d219f9f0d413`.
- 운영 등록 화면의 JS 28개, CSS 2개, 글꼴 8개는 재방문 시 디스크 캐시/immutable 정책을 사용했다. 브라우저 확장 프로그램의 스크립트 3개는 제외했다.
- 별도 캐시 비활성화 측정에서는 등록 초기 JS 28개가 512,262 bytes를 전송했다(Chrome CDP encodedDataLength 합계, 응답 헤더 포함).
- 등록 화면이 공유하는 `OpsTaskWorkspace`가 숨겨진 입력창과 직접입력 기간 필터의 날짜 선택기까지 정적으로 가져오고 있었다.

## 변경

`DatePickerControl`과 `DateTimePickerControl`을 모듈 최상위의 Next dynamic으로 분리한다. 기존 조건부 렌더링이 입력기를 요청할 때 같은 공용 모듈을 로드한다. 초기 목록에서는 달력 코드가 제외되고, 이후에는 기존 해시 파일 캐시를 재사용한다. 로딩 중에는 공용 Skeleton으로 36px 입력 높이와 상태 이름을 유지한다. 일시 입력은 실제 입력기와 같이 모바일 두 줄, 데스크톱 두 열의 자리를 유지한다.

기준 UI는 기존 등록/퇴원/단어 재시험 화면, 공용 `date-time-picker`, `calendar`, `Skeleton`이다. 날짜 선택·제한·초안·ref·기존 상태와 시각 규칙은 그대로 사용한다. DB/API/권한/저장/알림 변경은 없다.

## 빌드 비교

같은 환경의 `pnpm run build` 전후, client-reference manifest가 참조하는 중복 제거 JS를 측정했다. 프레임워크 부트스트랩을 포함한 실제 브라우저 전송량과는 별도 지표다.

| 화면 | 원본 bytes 전→후 | gzip bytes 전→후 |
| --- | ---: | ---: |
| 등록 | 1,346,743 → 1,260,602 | 379,659 → 354,507 |
| 전반 | 1,346,743 → 1,260,602 | 379,659 → 354,507 |
| 퇴원 | 1,346,743 → 1,260,602 | 379,660 → 354,507 |
| 단어 재시험 | 1,346,743 → 1,260,602 | 379,659 → 354,507 |

gzip 약 6.6% 감소. 초기 참조 청크에서 react-day-picker의 달력 구현이 사라진 것을 확인했다. 최초 날짜 입력 표시에는 지연 청크 로드가 추가되는 교환 조건이 있으며, 실제 체감 지연이나 API p95 개선을 의미하지 않는다.

재현: 각 revision에서 `pnpm run build` 후 `node scripts/qa/task-date-control-bundle.mjs`. 전후 청크별 근거는 `bundle-before.json`, `bundle-after.json`.

## 검증

- production build 성공(타입 검사 포함).
- 날짜 입력, 업무 workspace/페이지, 등록 workspace, 공용 입력 회귀 테스트 369개 통과.
- 로컬 실제 workspace + 합성 데이터: 최초 날짜 입력 청크 1회 로드, 날짜 필터 반영, 일시 기존 값/변경/지우기, Enter 열기, Escape와 날짜 버튼 초점 복원, 미저장 보호 확인. 390px에서 전체 scrollWidth 390, 외부 Supabase 요청 0. 임시 QA 경로와 서버는 제거했다.
- 로컬 dev에서 기존 HWP 브라우저 확장이 html에 주입한 속성으로 hydration 경고 1건이 발생했다. 운영 콘솔 확인은 별도로 수행한다.
- PR CI, 운영 배포, 운영 다운로드 재측정과 실제 화면 확인은 release-verification.md에 별도 기록한다.
- 정적 파일 캐시는 정상이며, 관측된 간헐적 공통 API 대기는 이번 변경의 해결 범위가 아니다.
