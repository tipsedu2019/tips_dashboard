alter table public.ops_registration_details
  add column if not exists pipeline_status text not null default '0. 등록 문의'
  check (
    pipeline_status in (
      '0. 등록 문의',
      '1. 레벨테스트 신청',
      '2. 상담 신청',
      '3. 상담 완료 (7일 동안 기다리는 중)',
      '4-1. 현재반 대기 신청',
      '4-2. 신규반 대기 신청',
      '4-3. 다음 개강 알림 요청',
      '5. 등록 신청',
      '6. 수납 진행 중',
      '7. 등록 완료',
      '8. 미등록',
      '9. 문의만'
    )
  );

create index if not exists ops_registration_details_pipeline_status_idx
  on public.ops_registration_details(pipeline_status);
