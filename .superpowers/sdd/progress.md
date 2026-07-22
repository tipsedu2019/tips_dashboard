작업 0: 완료. 기존 작업을 보존한 별도 작업 트리를 만들고 Supabase 플러그인 실행 환경을 확인했습니다. Docker는 사용하지 않았습니다.
작업 1: 완료. 등록 문의·과목 트랙·초기 진행·예약·담당자·이력을 한 원자 요청으로 저장하고, 같은 논리 요청의 중복 생성을 막았습니다.
작업 1A: 완료. 새로고침하면 사라지는 화면 전용 알림 설정을 제거하고 공통 영속 설정 화면으로 연결했습니다.
작업 2: 완료. 등록 업무 변이와 자동 이력 v2를 같은 트랜잭션으로 연결하고 기존 v1 이력의 읽기 호환성을 유지했습니다.
작업 3: 완료. 등록 이력을 편집할 수 없는 운영 타임라인으로 정리하고 데스크톱·모바일에서 같은 의미를 유지했습니다.
작업 4: 완료. 7개 업무의 알림·채널·대상·상태 어휘와 순수 데이터 계약을 고정했습니다.
작업 5: 완료. 비공개 정규 알림 스키마, 사용자별 읽음, 감사, 요청 원장과 기본값이 꺼진 12개 실행 플래그를 구성했습니다.
작업 6: 완료. 역할 기반 설정·감사·연결 API와 변경 번호 충돌·재실행 안전 계약을 구현했습니다.
작업 7: 완료. 내구성 작업 처리기, 점유·점유 기한, 대상 재계산, 전달 결과 보존과 알림함 투영을 구현했습니다.
작업 8: 완료. 7개 업무가 같은 영속 알림 설정 화면과 서버 계약을 사용하도록 연결했습니다.
작업 9: 완료. 사용자별 읽음 영수증과 푸시 알림 준비 상태를 구현하고 준비되지 않은 상태를 성공처럼 표시하지 않게 했습니다.
작업 10: 완료. 등록 예약 달력, 월·주 보기, 예약 ID 딥 링크와 기존 상세 연결을 구현했습니다.
작업 11: 완료. 전일·당일·1시간 전 등록 예약 알림 생산자와 예약 변경 시 오래된 알림 취소를 구현했습니다.
작업 12: 완료. 예약 충돌 시 입력 초안 보존, 변경 전후 알림 확인, 처리 상태와 안전한 재시도 경계를 구현했습니다.
작업 13: 완료. 등록 공통·전화상담·방문상담·SOLAPI를 네 개의 독립 소유권 범위로 연결했습니다.
작업 14: 완료. 7개 업무별 단일 어댑터와 외부 호출 직전 권위 재검증을 구현했습니다.
작업 15: 완료. 할 일·영어 단어 재시험의 고정 원자 변이와 브라우저 사후 이벤트 제거를 구현했습니다.
작업 16: 완료. 전반·퇴원의 제출·완료 이벤트와 명단 전환을 업무 변이와 같은 트랜잭션으로 연결했습니다.
작업 17: 완료. 휴보강 승인·재처리·중복 생성 방지·강의실 동시성·배타 소유권을 구현했습니다.
작업 18: 완료. 전자결재 신청·댓글·결재자·승인·반려·철회 이벤트를 권위 업무 변이와 함께 기록하도록 구현했습니다.
작업 19: 완료. 등록 네 범위의 인수인계, 기존·정규 체크섬 분리와 전송 전 소유권 반환 경계를 구현했습니다.
작업 20: 구현 완료. 구형 원문 호출 폐쇄, 24시간 증거 계약, 고정 일정 관리 스크립트, 운영 지표와 안전한 순방향 마이그레이션을 준비했습니다. 원격 적용과 운영 일정 설치는 실행하지 않았습니다.
작업 21: 구현 완료. 10개 범위 전환·롤백 검증과 독립 계산 방식의 순수 로컬 그림자 검증 실행기를 완료했습니다. 10개 범위 일치, 네트워크·DB·외부 공급자·알림함·중복 외부 시도는 모두 0건입니다.
작업 22: 로컬 출고 검증 완료. 알림 회귀 `326/326`, 화면·업무 통합 `961/961`, 전체 Node `1483/1483`, 결정적 증거·작업 처리기·미리보기 집중 회귀 `67/67`, TypeScript, ESLint 오류 0건, 변경 공백 검사, 운영용 빌드 정적 페이지 `78/78`, 7개 업무 진입점 데스크톱·모바일 `14/14`를 통과했습니다. 로컬 서버는 `http://localhost:3001`에서 계속 실행 중입니다.

실행하지 않은 운영 작업: 실제 PostgreSQL pgTAP, 원격 마이그레이션, 플래그 변경, 일정 설치, 24시간·7일 관찰, 소유자 전환, 실제 Google Chat·Web Push·SOLAPI 발송, 원격 저장소 전송과 배포. 이 항목들은 현재 로컬 구현 완료 범위에 포함되지 않습니다.

작업 23: 완료. 새 canonical worker의 Google Chat·Web Push HTTP 408을 자동 재시도하지 않는 `delivery_unknown`으로 종결하고 425의 bounded retry를 보존했습니다.
작업 24: 완료. 즉시형 규칙의 수신자 0명과 과목 Chat `unknown`을 `audience` 증거로 남겨 `skipped/no_recipient`로 기록할 수 있게 했습니다. TypeScript 호환성 보완과 독립 재리뷰까지 통과했습니다.
작업 25: 조용한 종단간 검증 완료. Supabase 운영 쓰기·실제 공급자 호출 없이 174개 규칙, 7개 업무, 취소·재시도·중복·대상 계약을 확인했습니다. 알림 회귀 `337/337`, 전체 Node `1499/1499`, TypeScript, ESLint, 브라우저 7/7, 순수 preview 10/10 두 번을 통과했고 새 시스템 실제 발송은 계속 꺼져 있습니다.
작업 26: 완료. 최종 리뷰에서 발견한 공용 provider 경계를 바로잡아 legacy route의 408 기본 동작을 기존 `retry_wait`으로 보존하고, canonical production worker만 명시 정책으로 `delivery_unknown`을 사용하게 했습니다. audience의 `skipped/no_recipient`와 worker claim 제외도 한 계약 테스트로 연결했습니다.
작업 27: 완료. 2026-07-19 승인 범위에 따라 Supabase에 canonical bridge `191000`~`194500`을 설치하고 로컬 SQL 바이트·MD5 5/5 일치를 확인했습니다. 적용 전 rollback dry-run에서 `191000` CASE, `192000` event_key·동일인 rejected 규칙, `194000` CASE·composite INTO 세 곳, `194500` schema-qualified EXTRACT 오류를 수정·재검증했습니다. 휴보강 93건은 canonical 이벤트 23건·전달 93건·폐쇄 소유권 93건으로 누락·위험 상태·금지 fanout 0건, 체크섬 일치입니다.
작업 28: bridge 출고 검증 완료. 전체 Node `1507/1507`, TypeScript, ESLint, 변경 공백 검사를 통과했습니다. 설정 UI 외 런타임 플래그 11개, shadow, worker 일정, 소유권 전환, `195000` 이후 마이그레이션, Google Chat·Web Push·SOLAPI 실제 발송은 모두 꺼져 있습니다. 같은 안전 코드의 `main`·Vercel 배포와 5분 간격 배포 영수증 관측 시작은 다음 즉시 단계이며 아직 완료로 기록하지 않습니다.

등록 양식 개선 작업 1: 완료. 학년별 학교 후보 카탈로그, 기존 학교 값 보존, 선택 조회 실패 격리 구현과 독립 검토를 완료했습니다 (`89e1bee..d859915`, CLEAN).
등록 양식 개선 작업 2: 완료. 생성·상세 공통 과목/문의 입력 컴포넌트, 승인된 4행 배치, 학년별 학교 선택 연결 구현과 독립 검토를 완료했습니다 (`d859915..0b31d88`, CLEAN).
등록 양식 개선 작업 3: 완료. 본문 자동 이력을 제거하고 상세 헤더의 닫기 버튼 왼쪽 시계 Popover로 이동했으며, 내부 읽기 전용 이력 모델과 필터를 보존한 구현·독립 검토를 완료했습니다 (`0b31d88..3b5848d`, CLEAN).
등록 양식 개선 작업 4: 완료. 문의 예외·레벨테스트·상담·배정·입학 트랙 전체를 하나의 과목 탭으로 전환하고, 비활성 편집기 마운트·초안 보존·예약 참여 과목별 노출을 상태별로 보강한 뒤 독립 재검토를 완료했습니다 (`3b5848d..c7c9866`, CLEAN).
등록 양식 개선 작업 5: 완료. 무저장·무발송 브라우저 검증기, 전체 fixture 상태 지문, 기존 달력·권한·마이그레이션·종료·오류·접근성 회귀를 복원하고 독립 재검토를 완료했습니다 (`c7c9866..5f7a98e`, CLEAN). 전체 Node `1655/1655`, TypeScript, ESLint, 빌드 `78/78`을 통과했으며 로컬 main의 실제 데스크톱·모바일 화면에서 공통 양식, 학년별 학교, 과목 탭 5개 영역, 헤더 자동 이력을 무저장·무발송으로 확인했습니다.
등록 양식 개선 작업 6: 완료. 자동 이력을 Escape로 닫을 때 Radix 기본 포커스가 상세창을 맨 위로 이동시키는 원인을 확인하고, Escape 종료에만 `preventScroll` 포커스 복귀를 적용했습니다. 열린 이력에서 상세창을 먼저 스크롤하는 회귀 검증으로 보강했으며 전체 Node `1655/1655`, 관련 `758/758`, 집중 `111/111`, TypeScript, 대상 ESLint와 실제 데스크톱 `220px → 220px` 스크롤 보존, 모바일 레이어·포커스·무가로넘침을 확인했습니다.
등록 진행 개선 작업 1: 완료. 등록 신규·수정·과목 상세·예약 상세 진입이 학교 옵션을 강제 갱신하도록 바꾸고 `초등 > 기타` 후보 회귀를 고정했습니다 (`a369b8e..390b494`, 검토 통과, 집중 테스트 `91/91`).
등록 진행 개선 작업 2: 완료. 선택 과목의 권위 트랙 상태로 상단 5단계 진행표를 계산하고 과목 탭을 헤더 아래로 이동했으며, 중복 일반 상태 표시는 제거하고 실제 업무 상태는 유지했습니다 (`390b494..237246e`, 검토 통과, 집중 테스트 `128/128`).
등록 진행 개선 작업 3: 완료. 레벨테스트 장소를 본관·별관으로 제한하고 생성·수정 UI, 서비스, fixture, 공개 RPC 저장 경계를 함께 보강했습니다. 방문상담 자유 입력과 레거시 읽기는 유지했으며 독립 재검토를 통과했습니다 (`237246e..5193bf1`).
등록 진행 개선 작업 4: 완료. 입학 처리를 5단계 순서형 체크 진행표로 통합하고 완료 배치의 읽기 전용 표시와 신규 처리 회차 분기를 보강했습니다. SSR 렌더 검증과 독립 재검토를 통과했습니다 (`cfef75c..086798d`).
등록 진행 개선 작업 5: 완료. 실제 로컬 등록 화면에서 신규·저장 양식, 초등 기타 학교, 과목 탭, 상단 진행표, 헤더 자동 이력, 430px 무가로넘침을 확인했습니다. 전체 Node `1674/1674`, TypeScript, ESLint, 프로덕션 빌드를 통과했습니다.

과학 과목 기반 확장 (2026-07-22): 설계와 9개 작업 TDD 계획 완료. `.git` 메타데이터가 읽기 전용이라 별도 브랜치·작업트리·커밋 없이 현재 작업공간에서 수행하며, 기존 단어 재시험 dirty 변경 4개 파일은 보존한다.
과학 작업 1: 완료 (커밋 불가 working-tree diff, task review Approved). 고정 3과목 registry, unknown fail-closed, 등록 service/history/calendar ordering, 타입 exhaustiveness를 구현했고 focused 272/272, TypeScript, ESLint를 통과했다. picker/intake를 포함한 consumer 전환은 Task 4에서 완료했고 최종 범위 리뷰도 통과했다.
과학 작업 2: 완료 (커밋 불가 working-tree diff, 재리뷰 Approved). 고정 과목 설정·정확한 5개 과학 영역·RPC-only 권한·활성 과학팀 원장 검증·구버전 capability fallback을 구현했다. Node 37/37, TypeScript, ESLint 통과. PostgreSQL/pgTAP은 로컬 실행 파일 부재로 source만 작성했고 최종 보고에 미실행으로 유지한다.
과학 작업 3: 완료 (커밋 불가 working-tree diff, 독립 리뷰 Approved). `/admin/settings/subjects`의 고정 3과목·admin-only 저장/read-only direct URL, 과학팀 조직·가입·시간표 정규화, 강의실 다중 과목과 `별관 4강` forward migration을 구현했다. 리뷰의 DB 허용 학년 표시 Important를 TDD로 수정했고 focused 50/50, TypeScript, 대상 ESLint를 통과했다. 전체 suite/build와 인증 전 경로 검증은 Task 9에서 완료했으며 PostgreSQL migration 적용만 미실행이다.
과학 작업 4: 완료 (커밋 불가 working-tree diff, 독립 재리뷰 Approved). 등록 클라이언트의 고정 3과목 capability·고등 학년 gate, exact 과학팀 기본 원장, 담당 과학 teacher의 read-only 상담 완료, 알림 canonical track-subject pair 검증, capability 조회 시 저장 director active 재검증, 담당 상담 전용 과학반 lazy read를 구현했다. 후속 RED에서 `종강` 누락과 viewer 단독 무기한 cache를 고쳐 viewer+consultation 60초 TTL로 제한했고 focused 372/372, TypeScript, 대상 ESLint, 공백 검사를 통과했다. 전체 suite/build와 인증 전 경로 검증은 Task 9에서 완료했으며 PostgreSQL/pgTAP runtime만 미실행이다.
과학 작업 5: 완료 (커밋 불가 working-tree diff, 독립 재리뷰 Approved). 등록 DB의 1~3과목·과학 고등학생·별도 과학 원장·선택적 레벨테스트·공유 예약/달력/알림/이력 경계를 순방향 확장했다. migration 전 create/sync의 `수학, 영어` lexical receipt만 exact 호환 replay하고 새 receipt는 영어→수학→과학 canonical 순서를 유지하도록 TDD로 보강했으며, 동일 key의 다른 payload는 계속 거부한다. focused 86/86, 전체 registration 664/664, TypeScript, 대상 ESLint, PostgreSQL 17 AST 113/103 statements, PL/pgSQL 17/2 functions, 공백 검사를 통과했다. 로컬 PostgreSQL 실행 환경이 없어 pgTAP runtime과 원격 migration 적용은 실행하지 않았다.
과학 작업 6: 완료 (커밋 불가 working-tree diff, 독립 v4 재리뷰 Approved). 과학 반의 고1~고3·active 영역·exact 과학팀 교사·과학 강의실 경계와 교재 5영역/high taxonomy, 별도 science 월마감 bucket을 구현했다. 리뷰에서 NULL 학년 DB 우회, 후보 0건의 타과목 값 잔존, 신규 컬럼 전개 중 비과학 교재 저장 중단을 TDD로 고쳤다. 최종 범위 리뷰에서는 교재 blank/unknown subject의 `other` 흡수와 과학 key/label 불일치를 RED 5건으로 재현한 뒤, 쓰기 fail-closed와 active 영역 현재 label을 service·DB trigger 양쪽에서 강제했다. 후속 성능 리뷰의 row별 area RPC N+1도 RED 104/107로 재현해, UI의 단일 로드 map을 단건·일괄·상태 저장에 재사용하고 저장 중 area RPC 0회를 고정했다. v3 리뷰에서는 기존 편집·구매요청 등록 경로가 read normalization으로 raw unknown/blank subject를 `other`로 바꾸는 strict write 우회를 RED 107/110으로 재현했다. read fallback은 유지하되 edit form에는 raw 값을 보존하고 strict validation을 적용해, 명시적 canonical 과목 선택 전에는 거부하고 사용자가 `기타`를 직접 선택하면 저장되도록 110/110 GREEN으로 고쳤다. 최종 교재 경계 24/24, N+1 회귀 107/107, Task 6 집중 회귀 143/143, 전체 textbook 회귀 150/150, 기존 관련 회귀 351/351, PostgreSQL 21 statements/PLpgSQL 2 functions AST, TypeScript, ESLint, 공백 검사를 통과했다. PostgreSQL migration은 실제 실행하지 않았다.
과학 작업 7: 완료 (커밋 불가 working-tree diff, 독립 최종 리뷰 Approved). 학교 학사 일정·연간보드에 과학 시험일과 stable 과학 영역 key를 추가하고 고1~고3 생성, legacy 읽기, 4열 보드, drag 공통 검증, unknown type fail-closed를 구현했다. 최종 범위 리뷰에서 renamed active label이 seed label exact-match 때문에 제거되는 문제를 RED 44/48로 재현한 뒤, known key·nonempty dynamic label·active 계약과 seed sort/legacy label fallback을 분리했다. 달력·연간보드는 화면별 단일 active area map을 모든 행에 재사용해 현재 label을 표시하며 새 row별 RPC는 없다. focused 48/48, TypeScript, 대상 ESLint, 공백 검사를 통과했다.
과학 작업 8: 완료 (커밋 불가 working-tree diff, 독립 재리뷰 Approved). `google_chat.science`를 별도 disconnected·무비밀·미검증 연결로 추가하고 runtime flag·규칙·소유권·cron을 활성화하지 않았다. active revalidate/begin-send 전체 본문과 ACL을 보존해 science mapping만 확장했으며, canonical prepare가 exact track의 과목 설정을 결정론적으로 잠가 원장 변경 TOCTOU를 닫았다. 전체 알림 421/421, provider-zero 3/3과 provider/fetch 0회, PostgreSQL AST 33 statements·PL/pgSQL 11 functions, TypeScript, ESLint, 공백 검사를 통과했다.
과학 작업 9: 로컬 출고 검증 완료. 단어 재시험의 영어 전용 capability와 월간 결재 템플릿 비확장을 고정하고 `.pnpm-store` 547MiB는 삭제 없이 `/.pnpm-store/`만 ignore했다. 전체 Node 1790/1790, TypeScript, 전체 ESLint, `next build --webpack` 정적 페이지 79/79, 공백 검사를 통과했다. polling watcher로 재시작한 로컬 개발 서버에서 12개 관리자 경로가 HTTP 200으로 컴파일됨을 확인했으나, 격리 브라우저에 인증 세션이 없고 Chrome 연결도 제공되지 않아 실제 로그인 후 화면은 확인하지 못했다. PostgreSQL/pgTAP runtime, 원격 migration, 실제 알림, commit·push·deploy는 실행하지 않았다.

등록 상세 단일 저장 작업 1: 완료. 저장된 신청서의 한 `저장`, 통합 draft/service/fixture, 중복 요약 제거, 공통 옵션 UI를 요구하는 RED 계약 6건을 고정하고 독립 검토를 통과했다.
등록 상세 단일 저장 작업 2: 완료. 공통 정보와 과목을 한 트랜잭션으로 저장하는 `save_registration_case_inquiry_v1`과 pgTAP packet을 구현했다. 후기 공통 검증 실패의 tracks·events·common·revision·receipt 전체 rollback과 reminder revision 1→2 재물질화·이전 delivery 취소·provider-zero를 보강해 독립 재검토 승인을 받았고 Node SQL 계약 47/47을 통과했다. 로컬 PostgreSQL 부재로 pgTAP runtime과 원격 적용은 아직 실행하지 않았다.
등록 상세 단일 저장 작업 3: 완료. 저장 상세의 공통 필드와 과목을 하나의 `RegistrationInquiryDraft`, 하나의 dirty/conflict 복구 경로, 하나의 `저장`, 하나의 `save_registration_case_inquiry_v1` 호출로 통합했다. fixture는 모든 optimistic/capability/removal/identity 검증을 clone 전 수행하며 provider ledger를 건드리지 않는다. 서비스·fixture 89/89 통과, 독립 검토에서 Critical/Important/Minor 0건이었다. 전체 집중 224개 중 남은 3건은 계획된 Task 4~6 RED다.
등록 상세 단일 저장 작업 4: 완료. 각 단계의 중복 책임자·상태·일시 요약과 반복 잠금 문구를 제거하고 실제 작업이 없는 프레임을 숨겼다. 다중 migration review는 모든 과목 탭이 하나의 고정 검토 패널을 공유하고, 레벨테스트 제목 전용 프레임은 제거했다. 집중 계약·ESLint·독립 재검토를 통과했다.
등록 상세 단일 저장 작업 5: 완료. 등록 상세의 네이티브 select·confirm·details와 손수 만든 amber 패널을 공통 `RegistrationSelect`, `Dialog`, `Alert`, `Collapsible`로 전환했다. 접어도 편집 draft를 유지하고 다음 단계가 열리도록 보강했으며, 브라우저 검증기도 Radix 옵션·분리된 waiting/registration 섹션 계약에 맞췄다. 통합 225/225, TypeScript, 대상 ESLint를 통과했다.
등록 상세 단일 저장 작업 6: 완료. 전체 Node 1805/1805, provider-zero 62/62, TypeScript, 전체 ESLint, `next build --webpack` 79/79, `git diff --check`를 다시 통과했다. 새 빌드로 localhost:3000을 재시작하고 등록 경로 HTTP 200을 확인했다. 실제 저장 신청서에서 한 `저장`, 이전 저장 문구 0건, 보이는 비현재 단계 문구 0건, 중복 요약 0건, native select/details 0건, 가로 넘침 0건을 확인했다. 공통 Select, 접힘 draft 보존, 김법균 과학 책임자, 공통 삭제 확인창을 비파괴 QA했으며 임시 입력은 원복하고 저장·삭제·알림 호출은 실행하지 않았다.
등록 상세 단일 저장 작업 7: 완료. 원격 이력을 재확인한 뒤 `20260722142020_registration_science_director_and_case_delete`와 `20260722142108_registration_case_inquiry_atomic_save` 두 마이그레이션만 순서대로 적용했다. 김법균 과학 기본 책임자, 함수 owner·ACL·빈 search_path, dispatch·adapter off, science Chat disconnected, 대상 신청 미삭제를 확인했다. 보안 advisor ERROR는 0이고 admin 재검증이 있는 공개 삭제 definer 함수에 대한 의도된 WARN 1건만 증가했다. 최종 SQL 계약을 포함한 전체 Node, TypeScript, ESLint, build, 공백 검사를 다시 통과했으며 로컬 PostgreSQL 부재로 pgTAP runtime은 실행하지 않았다.
