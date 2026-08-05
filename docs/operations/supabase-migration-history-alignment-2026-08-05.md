# Supabase migration history alignment evidence (2026-08-05)

## Outcome

운영 Supabase에 이미 적용된 세 migration과 저장소의 SQL이 같은 내용인데 서로 다른 timestamp로 기록돼 있었다. 운영 history를 수정하거나 SQL을 다시 실행하지 않고, 저장소 파일명만 운영 version에 맞췄다.

- Project: `slnjqlzzhewblvttiidk` (`tips dashboard`)
- Region: `ap-northeast-2`
- Read-only status at verification: `ACTIVE_HEALTHY`, PostgreSQL 17
- Remote migration mutation: 0
- SQL replay: 0
- Workflow, worker, cron, notification provider activation: 0

## Failure evidence

다음 GitHub Actions 실행은 project link와 secret 전달 이후 `supabase db push --linked --include-all`에서 같은 오류로 실패했다.

- [Run 30930284103](https://github.com/tipsedu2019/tips_dashboard/actions/runs/30930284103)
- [Run 30804557922](https://github.com/tipsedu2019/tips_dashboard/actions/runs/30804557922)
- Error: `Remote migration versions not found in local migrations directory.`

## Exact identity evidence

운영 `supabase_migrations.schema_migrations`의 statement와 기존 로컬 SQL을 읽기 전용으로 비교했다. 세 건 모두 statement count 1이며 bytes와 MD5가 3/3 일치했다. SHA-256은 변경 후 파일 바이트를 고정하는 저장소 검증값이다.

| Remote version | Name | Obsolete local version | Bytes | MD5 | SHA-256 |
| --- | --- | --- | ---: | --- | --- |
| `20260730161538` | `notification_google_chat_connection_catalog` | `20260730143000` | 5818 | `4a674bc6342a705264ad5d9f56e59550` | `a3f72d4ec2a410796d5796019649859d5a329d5bec0e3e83f48242272dd88dda` |
| `20260731011040` | `notification_transfer_withdrawal_deep_links` | `20260730143100` | 9428 | `6edada646da4bf5993f0ff0778ec35e8` | `ed5dfb81c2cb5d1bc6dca5c38de62745c02d88b5a4b858ec57e8f0d2c6afb5ab` |
| `20260731011229` | `notification_owner_aware_delivery_summary` | `20260730143200` | 8161 | `6c193b9f3db8ca1c4d7bd8300f3a1282` | `eb06042e4e70e05d4fc745053dccc52ac01fa253928f3f04fa442f5ec9704b54` |

## Repository-only recovery

다음 세 파일은 SQL 바이트를 바꾸지 않고 rename했다.

| Before | After |
| --- | --- |
| `20260730143000_notification_google_chat_connection_catalog.sql` | `20260730161538_notification_google_chat_connection_catalog.sql` |
| `20260730143100_notification_transfer_withdrawal_deep_links.sql` | `20260731011040_notification_transfer_withdrawal_deep_links.sql` |
| `20260730143200_notification_owner_aware_delivery_summary.sql` | `20260731011229_notification_owner_aware_delivery_summary.sql` |

레이아웃 검증기는 새 파일의 regular-file 상태와 정확한 SHA-256을 요구하며, 폐기한 timestamp 파일이 다시 나타나면 실패한다. 운영 migration history의 `repair`, `revert`, 삭제 또는 재기록은 수행하지 않았다.

## Read-only version-set comparison after alignment

Supabase connector의 `list_migrations` 결과와 `supabase/migrations` 파일명을 다시 비교했다.

```json
{
  "remoteCount": 142,
  "localCount": 145,
  "remoteOnly": [],
  "localOnly": [
    "20260805110000_registration_customer_solapi_storage.sql",
    "20260805111000_registration_customer_solapi_message_rpc.sql",
    "20260805112000_registration_customer_solapi_activation.sql"
  ]
}
```

같은 version에서 name만 다른 네 과거 `remote_history_placeholder` 파일은 기존 상태이며 Supabase CLI의 timestamp set 비교에는 영향을 주지 않는다. 이번 복구 범위에서는 변경하지 않았다.

## Release boundary

이 증거는 저장소 migration identity가 운영 history와 정렬됐다는 뜻이다. 신규 SOLAPI migration 세 건은 아직 운영에 적용되지 않았다. Git push, PR, merge, Vercel 배포, SOLAPI 템플릿 설정 및 실제 발송은 별도 승인과 검증 전까지 수행하지 않는다.
