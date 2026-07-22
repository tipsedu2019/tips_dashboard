# 알림 cutover 격리 보관소

이 디렉터리는 실행 가능한 migration lane이 아니라, 아직 적용할 수 없는 과거 알림 cutover 원본을 바이트 그대로 보존하는 reference-only quarantine이다.

- 이 SQL을 직접 실행하거나 `supabase/migrations`로 복사·이동하지 않는다.
- Supabase CLI, Dashboard SQL editor, 자동화 workflow 또는 플러그인으로 적용하지 않는다.
- `manifest.json`의 파일 순서와 SHA-256은 불변 경계다.
- `tests/`의 pgTAP은 격리 SQL이 설치된 환경을 전제로 하므로 일반 `supabase test db` 실행 lane에 포함하지 않는다.

향후 전환은 정식 forward timestamp를 가진 새 migration으로 install과 activation을 분리해 다시 설계해야 한다. 그 설계는 `20260722120000_science_notification_connection.sql`의 최신 과학 알림 정의를 보존하고, 별도 승인과 운영 증거를 요구해야 한다.
