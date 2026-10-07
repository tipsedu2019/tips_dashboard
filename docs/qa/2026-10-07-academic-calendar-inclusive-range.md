# 학사 캘린더 저장 기간 읽기 검증

Base: main `32c8b5874a74a0d4436cb7d970b893d552292f31` (PR #109 이후).

## 문제와 변경

학사 캘린더 목록과 상세 RPC는 저장된 `note`의 `rangeEnd`를 제외하고 시작일을 종료일로 반환했다. 따라서 다일 일정이 하루만 표시되고, 수정창을 그대로 저장하면 종료일 메타데이터가 지워질 수 있었다.

새 `20261007013509_operations_calendar_inclusive_range.sql`은 캘린더와 상세 조회 함수 두 개만 교체한다. 유효한 ISO 날짜이며 시작일 이상인 저장 종료일을 포함해 반환하고, 표시 기간과 겹치는 이전 시작 일정도 조회한다. 누락·동일·역순·잘못된 날짜는 기존 단일일 계약을 유지한다. 기존 렌더러는 종료일을 포함하므로 exclusive 변환이나 하루 추가가 필요하지 않다.

일정 ID·sourceId·학년, 저장 데이터, 인증/RLS/ACL, annual RPC, 42일 조회 한도와 2,001개 밀도 거부는 유지한다. 월간·날짜 집계만 표시 범위로 제한해 매우 긴 저장 기간도 화면 밖 날짜를 모두 생성하지 않는다. 원래 종료일은 수정창과 저장에 보존한다.

## 실제 검증과 한계

- 전체 캡처 baseline + forward migration 146개를 네트워크 격리 합성 Supabase DB에 적용했다. 카탈로그/스모크 1,937개, 두 transactional preflight 25개·48개, 관련 SQL 세 파일 189개가 통과했다. local ledger 및 rollback을 검증하고 격리 자원을 정리했다.
- 새 pgTAP은 단일·다일·누락·동일·역순·잘못된 형식/실제 날짜·숫자/NULL·윤일·월/연도 경계, 조회 양끝 포함, 42/43일 SQLSTATE `22023`, 이전 시작 일정 2,001개 밀도 제한, saved-data 불변, 실제 authenticated 5 profile role 및 anon `42501`을 검사한다.
- 실제 SQL 진단 출력에서 캡처한 fixture를 production service/hook/workspace/Calendar/EventForm으로 replay한다. 다일과 별도 고2 단일 UUID를 클릭하여 exact detail을 열고 변경 없이 저장하는 실제 mutation handler의 `.update().eq('id', UUID)` payload를 합성 transport에서 검사한다. 저장 시작일·rangeEnd·학년·ID를 확인하며 운영 쓰기는 없다. ALL 및 9999년 종료는 직접 Form→payload 검사도 포함한다.
- 실제 local production build를 Playwright로 1440px·390px / Asia/Seoul·America/Los_Angeles 조합에서 검사했다. 데스크톱 다일 막대 너비, 모바일 3개 날짜 목록, 상세 시작/종료일, Escape 후 초점 복귀, 가로 overflow 및 page error를 확인했다. 원래 공용 스타일을 유지했다. 실제 운영 로그인 UI와 실데이터를 변경하거나 운영 배포를 검증한 것은 아니다.
- TypeScript·ESLint(기존 warning 7개, error 0)·webpack build와 Squawk 0 issues를 확인했다. GitHub PR 검사는 별도 exact-head 결과를 기준으로 한다.

## 적용 범위

검토용 PR만 생성한다. 해당 branch의 Vercel Preview를 비활성화하며 merge·배포·운영 DB 적용은 하지 않는다. 운영 해결에는 새 조회 migration과 이 UI 변경의 적용이 필요하지만 별도 승인/조율 후 수행한다. 기존 annual migration (`20261006183148`; 운영 기록 `20261007011438`)을 다시 적용하지 않는다. PR #97 installer 및 다른 PR/branch의 운영 범위는 변경하지 않는다.

SQL provenance: `tests/fixtures/academic-calendar-inclusive-range-sql-output.json`. 원시 캡처, 실행 로그, 화면 PNG 및 patch/source SHA는 작업 산출물 `academic-calendar-range-artifacts`에 별도로 보존한다. Fixture의 owner RPC 캡처와 별도 authenticated role assertion을 구분하며, local run은 signed HTTP/JWT probe를 실행하지 않았다. 해당 probe는 기존 GitHub isolated CI에서 별도로 확인한다.
