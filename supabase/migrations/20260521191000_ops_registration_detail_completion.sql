alter table public.ops_registration_details
  add column if not exists phone_consultation_at timestamptz,
  add column if not exists visit_consultation_at timestamptz,
  add column if not exists makeedu_invoice_sent boolean not null default false,
  add column if not exists textbook_billing_issued boolean not null default false;
