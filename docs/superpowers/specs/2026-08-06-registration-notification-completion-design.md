# 등록 알림 완성 설계

**작성일:** 2026-08-06  
**범위:** 레벨테스트 저장 확인, 등록 Google Chat 알림, 알림 설정 한국어 변수·미리보기, Google Chat 공통 링크 버튼, 고객 알림톡 발송 감사·중복 잠금

## 1. 목표

등록 업무에서 다음 동작을 한 흐름으로 완성한다.

1. 레벨테스트 예약 저장 성공·실패를 모달 안에서 확실히 확인한다.
2. 상담 신청, 상담 완료, 대기 신청, 등록 신청 이벤트를 관리팀 Google Chat에 전달할 수 있게 한다.
3. 알림 설정에서는 `{subjects}` 같은 내부 키 대신 `{과목}` 같은 한국어 변수만 보고 편집한다.
4. 알림 설정에서 실제 값이 들어간 결과를 저장 전에 미리 본다.
5. 모든 Google Chat 알림의 대시보드 URL은 본문에 노출하지 않고 `대시보드에서 보기` 버튼으로 제공한다.
6. 고객 알림톡은 발송 요청자와 요청 시각을 표시하고, 같은 고객·같은 프로세스의 중복 발송을 DB와 UI에서 함께 막는다.

## 2. 확인된 현재 상태

- 레벨테스트 예약 저장 확인창은 중첩 다이얼로그 때문에 저장 직후 보이지 않는 문제가 있었고, 선행 커밋 `d663a09c`에서 같은 모달 안의 확인 단계로 수정했다.
- 운영 DB의 Google Chat 연결 5개는 모두 `encrypted_active`이며 최근 검증 오류가 없다.
- 등록 알림 발송 런타임 플래그는 모두 꺼져 있다.
- `registration.case_created`와 `registration.registration_completed`의 관리팀 Google Chat 규칙은 존재하지만 비활성화되어 있다.
- `registration.consultation_completed`와 `registration.waiting_transitioned` 이벤트는 기록되지만 대응 규칙이 없어 전달 행이 생성되지 않는다.
- `registration.admission_started`도 관리팀 Google Chat 규칙과 콘텐츠 계약이 없다.
- Google Chat 공통 provider는 현재 제목·본문·절대 URL을 하나의 `text` 문자열로 발송한다.
- 알림 설정의 템플릿 저장 계약은 영문 키를 사용하지만, 콘텐츠 계약에는 이미 한국어 토큰과 영문 키의 1:1 대응이 있다.
- 고객 알림톡 outbox에는 `confirmed_by`, `confirmed_at`이 있지만 공개 응답과 화면에는 발송자 이름이 없다.
- 고객 알림톡 중복 키는 현재 source fingerprint를 포함하므로 대기·입학 안내도 원본 내용 변경 후 다시 열릴 수 있다.

## 3. 선택한 접근

### 3.1 한국어 변수는 화면 별칭으로 제공한다

DB 템플릿, checksum, worker render context의 영문 키 계약은 유지한다. 설정 UI 경계에서만 다음 변환을 수행한다.

- 화면 표시: `{subjects}` → `{과목}`
- 화면 입력 저장: `{과목}` → `{subjects}`
- 변수 목록: `{과목}`만 표시하고 내부 영문 키는 숨긴다.

이 방식은 기존 템플릿 버전과 worker 계약을 깨지 않으면서 사용자에게는 한국어 편집 경험만 제공한다. 한국어 토큰은 콘텐츠 계약에서 서버가 내려주는 allowlist만 사용하므로 임의 별칭은 허용하지 않는다.

검토한 대안은 다음과 같다.

- DB와 worker까지 한국어 토큰을 정식 저장 키로 마이그레이션: 가장 일관되지만 기존 checksum·템플릿 버전·renderer·DB 함수 전부를 바꿔야 해 회귀 위험이 크다.
- UI 라벨만 한국어로 바꾸고 입력은 영문 키 유지: 구현은 작지만 사용자가 원하는 `{과목}` 직접 편집을 충족하지 못한다.

### 3.2 설정 미리보기는 로컬 결정론 렌더링으로 만든다

편집 다이얼로그 안에 `알림 미리보기` 카드를 둔다. 현재 제목·본문 템플릿에 콘텐츠 계약별 안전한 예시 값을 넣어 즉시 갱신한다.

- 실제 운영 데이터, 고객 전화번호, provider 호출을 사용하지 않는다.
- 학생은 `김민준 학생`, 과목은 `영어 · 수학`, 일정은 KST 예시, 장소는 `본관 상담실`처럼 명백한 예시 값을 쓴다.
- 알 수 없는 변수나 필수 변수 누락은 기존 저장 차단 오류와 동일하게 표시한다.
- 선택 행 변수는 빈 값이 아니라 의미 있는 예시 한 줄로 보여 레이아웃을 확인할 수 있게 한다.

### 3.3 Google Chat은 공통 카드 payload를 사용한다

공통 provider가 모든 workflow에 대해 다음 구조를 생성한다.

- `cardsV2[0].card.header.title`: 렌더링된 제목
- `textParagraph.text`: HTML 이스케이프된 본문
- `buttonList.buttons[0]`: `대시보드에서 보기`
- `onClick.openLink.url`: 기존 allowlist를 통과한 `https://tipsedu.co.kr/admin/...` 절대 URL

본문과 제목에는 URL을 허용하지 않고, URL은 버튼 action 안에만 둔다. 내부 상대 경로 allowlist, 허용 query key, 중복 query key 차단, traversal 차단은 그대로 유지한다. 직렬화된 전체 메시지가 32KB를 넘으면 provider 호출 전에 실패한다.

### 3.4 등록 관리팀 알림은 누락된 세 이벤트를 canonical 규칙으로 추가한다

관리팀 Google Chat 대상 이벤트는 다음 네 업무 의미로 정리한다.

| 화면 의미 | 이벤트 키 | 처리 |
|---|---|---|
| 상담 신청 | `registration.case_created` | 기존 규칙·라벨·템플릿 정비 |
| 상담 완료 | `registration.consultation_completed` | 새 콘텐츠 계약·규칙·템플릿 |
| 대기 신청 | `registration.waiting_transitioned` | 새 콘텐츠 계약·규칙·템플릿 |
| 등록 신청 | `registration.admission_started` | 새 콘텐츠 계약·규칙·템플릿 |

새 이벤트는 학생, 과목, 현재 상태를 필수 사실로 사용한다. raw status 대신 presentation 계층에서 각각 `상담이 완료됐어요`, `대기 신청이 접수됐어요`, `등록 절차가 시작됐어요`로 변환한다. 링크는 모두 해당 등록 상세의 `taskId`로 연결한다.

기존 상담 신청과 새 세 규칙은 DB 마이그레이션에서 활성 규칙으로 준비하되, 운영 발송 플래그 변경은 코드·마이그레이션 적용과 분리한다. 이전 이벤트를 소급 발송하지 않는다.

### 3.5 고객 알림톡 중복 잠금은 프로세스 의미로 고정한다

중복 잠금 키는 다음과 같이 정의한다.

| 메시지 종류 | 1회 기준 |
|---|---|
| 레벨테스트 예약 | 고객 + 예약 ID + 예약 버전 |
| 방문상담 예약 | 고객 + 예약 ID + 예약 버전 |
| 예약 리마인드 | 고객 + 예약 ID + 예약 버전 |
| 대기 안내 | 고객 + 과목 track ID |
| 입학신청 안내 | 고객 + 등록 task ID |

예약 일정·장소가 바뀌어 `source_revision`이 증가하면 새 예약 버전의 안내를 한 번 더 보낼 수 있다. 같은 버전에서는 템플릿이나 본문이 바뀌어도 다시 열리지 않는다. 대기·입학 안내는 source fingerprint가 달라져도 다시 열리지 않는다.

새 dedupe 계산 전에 기존 outbox를 위 의미 기준으로 조회해, 이미 생성된 과거 행도 잠금 소유자로 인정한다. DB advisory lock과 unique dedupe key를 함께 유지해 동시 클릭에도 한 행만 생성한다. provider 결과가 `unknown` 또는 `failed_hold`여도 자동 재발송은 허용하지 않는다.

### 3.6 발송 감사 정보는 불변 이름 스냅샷으로 제공한다

outbox에 `confirmed_by_name`을 추가한다.

- 신규 행 생성 시 현재 profile 이름을 스냅샷으로 저장한다.
- 기존 행은 현재 profile 이름으로 안전하게 보정한다.
- 결과·이력 API는 `confirmedByName`, `confirmedAt`을 반환한다.
- 미리보기와 발송 후 화면에 `발송 요청 · 김관리 · 2026. 8. 6. 오후 3:20` 형식으로 표시한다.
- 중복 잠금 상태에서는 발송 버튼을 비활성화하고 기존 발송자·시각·상태를 함께 보여준다.

프로필 이름이 나중에 바뀌어도 당시 화면에 표시된 감사 이름은 변하지 않는다.

## 4. 데이터 및 실행 흐름

### 4.1 Google Chat

1. 등록 상태 변경 RPC가 canonical notification event를 기록한다.
2. event 시점의 활성 규칙·템플릿 snapshot으로 delivery를 만든다.
3. worker가 presentation context를 생성하고 템플릿을 렌더링한다.
4. 공통 Google Chat provider가 allowlist 경로를 절대 URL로 변환한다.
5. provider는 URL 없는 card 본문과 `대시보드에서 보기` 버튼을 webhook에 POST한다.
6. 결과는 기존 delivery 상태 기계로 기록한다.

### 4.2 고객 알림톡

1. 사용자가 미리보기를 연다.
2. readiness RPC가 의미 기반 잠금 여부와 최신 이력을 함께 반환한다.
3. 잠금이 없고 provider gate가 준비된 경우에만 expiring preview receipt를 만든다.
4. 사용자가 `확인 후 발송`을 누르면 claim RPC가 의미 기반 중복 소유자를 DB에서 다시 확인한다.
5. 새 outbox 행에는 발송자 ID·이름·시각을 함께 기록한다.
6. provider attempt marker 이후 한 번만 network boundary를 넘는다.
7. 결과와 상관없이 같은 의미 범위는 계속 잠긴다. 예약 버전이 바뀐 경우에만 새 범위가 열린다.

## 5. 오류와 안전 경계

- 한국어 변수 변환은 서버 allowlist에 있는 정확한 완성 토큰만 바꾼다. 불완전한 중괄호는 기존 검증 오류로 남긴다.
- Google Chat 카드 본문은 HTML 특수문자를 이스케이프한다.
- 링크 allowlist 실패, URL 포함 제목·본문, 32KB 초과는 provider 호출 전에 `render_validation_failed`로 종료한다.
- 누락된 등록 payload나 지원하지 않는 상태는 presentation 단계에서 fail closed 한다.
- 고객 알림톡은 preview receipt 없이 발송할 수 없다.
- `pending`, `accepted`, `unknown`, `failed_hold` 모두 중복 잠금 소유자다.
- 관리자 복구는 상태 확정용이며 dedupe 잠금을 해제하지 않는다.
- 테스트와 브라우저 QA에서는 fake transport를 사용하고 Google Chat·SOLAPI 실제 provider 호출을 하지 않는다.

## 6. 테스트 전략

1. 한국어 변수 양방향 변환, 불완전 토큰, 충돌 없는 round trip 단위 테스트
2. 설정 미리보기 예시 렌더링과 미상 변수 차단 테스트
3. Google Chat `cardsV2` 구조, HTML escape, 버튼 URL, raw URL 비노출, 32KB 경계 테스트
4. 네 등록 이벤트의 콘텐츠 계약·presentation·대상·deep link 테스트
5. DB 마이그레이션 구조 테스트: 새 규칙/템플릿/계약, sender snapshot, 의미 기반 중복 조회
6. isolated DB QA: 같은 버전 동시 claim 1행, 예약 버전 증가 후 1회 허용, 대기·입학 영구 잠금, 기존 outbox 호환
7. 알림톡 계약/route/UI 테스트: 발송자·시각 표시와 disabled 상태
8. TypeScript, ESLint, `next build --webpack`, diff check
9. localhost 데스크톱·모바일에서 등록 저장 확인, 알림 설정 한국어 편집·미리보기, 알림톡 잠금 UI 확인

## 7. 릴리스 경계

다음은 각각 별도 완료 증거가 필요하다.

1. 로컬 코드·테스트 완료
2. 운영 DB 마이그레이션 적용
3. GitHub `main` push
4. Vercel Production `READY`
5. Google Chat 등록 dispatch 플래그 활성화
6. SOLAPI 템플릿 승인·receipt 일치·환경변수·activation mode 준비
7. 실제 Google Chat 또는 고객 알림톡 provider 전달 확인

이번 구현 커밋은 1번까지 수행한다. 운영 DB 적용, push·배포, 런타임 플래그 활성화, 실제 provider 발송은 별도 승인과 증거 없이 완료로 간주하지 않는다.
