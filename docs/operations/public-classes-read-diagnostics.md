# 공개 수업 조회 실패 진단

공개 요약과 호환 API의 Supabase 클라이언트는 실패한 GET 요청에 `public_classes_read_failed`를 기록한다. 학생·수업의 원문 데이터, URL, query string, key/header, 원시 오류 message/details/hint는 기록하지 않는다. 성공 응답과 본문은 그대로 SDK에 전달한다.

필드는 `phase`(config/query), `table`(classes/textbooks/progress_logs 또는 null), HTTP `status`, SQLSTATE/PostgREST `code`, `kind`(unconfigured/upstream/timeout/aborted/network), `durationMs`다. 네트워크 오류처럼 HTTP 응답이 없으면 status는 null이다. 생성할 수 없는 클라이언트는 기존 null/fallback 경계로 처리한다.

오류 코드 파싱은 JSON 오류 본문 복사본의 최대 8KiB와 50ms 대기로 제한한다. 본문이 크거나 정지·손상되면 code는 null이고 HTTP 상태만 남긴다. 원래 응답이나 예외는 바꾸지 않으며, logging sink의 실패도 기존 처리 결과에 영향을 주지 않는다. 성공 응답은 복제·파싱하지 않는다. 정상적인 빈 결과는 실패 로그를 만들지 않는다.

`public_classes_summary_unavailable`는 실패 결과가 성공 캐시를 덮어쓰지 못하도록 하는 기존 경계다. 이 로그에 인접한 구조화된 이벤트를 같은 deployment, 시간, 요청 ID로 대조한다. HTTP200과 공개 API source=supabase만으로 직접 최신 DB 읽기가 성공했다고 판단하지 않는다. 마지막 성공 캐시나 최대 24시간 스냅샷일 수 있다. generatedAt과 CDN HIT/STALE, 이후 자연 갱신 여부도 함께 확인한다.

이 진단은 클라이언트 설정과 HTTP/전송 실패를 포착한다. HTTP200 이후 SDK 본문 파싱이나 애플리케이션 데이터 변환 오류를 모두 분류하는 진단은 아니다. 이러한 오류는 별도의 재현과 후속 조사 대상으로 남는다.

## 2026-09-12 확인

- 기준 main `5c94199f298ffb5c6193e59c64ae4ac94ffe7254`, 기존 Production `dpl_7F3N31b1unfSUbe4dZMd4zCtJD8a`.
- 기존 로컬 설정을 사용한 운영 요약 조회 1회는 HTTP200, 원본 73행/공개 67개였다. 약 954ms이며 Vercel 런타임 측정은 아니다.
- 전체 호환 조회 1회도 classes/textbooks/progress_logs HTTP200, 공개 67개였다. 약 2,683ms. 데이터 쓰기·고객 발송 없음.
- 공개 GET의 generatedAt은 처음 `2026-09-11T12:04:51.308Z`였고 이후 자연 갱신으로 `2026-09-12T04:46:24.812Z`로 전진했다. 마지막 관찰은 HIT/HTTP200이었다.
- 앞선 배포의 일시적인 summary 오류는 이번 읽기에서 재현하지 못했다. 이 변경을 과거 upstream 장애의 원인 해결이나 성능 개선으로 주장하지 않는다.
- 새 동작은 실제 설치 Supabase SDK와 가짜 HTTP 응답을 연결해 권한·게이트웨이·네트워크·타임아웃·오류 코드 비공개·본문 보존·로거 실패·성공 빈 결과를 검증했다. 실제 Next 캐시 통합 검증을 포함한 관련 회귀 63/63, 타입·린트·빌드·조회 계약 검사 통과.

관련 공식 문서: [Next unstable_cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache), [Vercel 캐시 진단](https://vercel.com/docs/caching/cdn-cache/debug-cache-issues), [Supabase abortSignal](https://supabase.com/docs/reference/javascript/abortsignal). 현재 설치 SDK 및 Next 16.1.1 동작을 직접 확인했으며 라이브러리나 DB 계약은 변경하지 않았다.
