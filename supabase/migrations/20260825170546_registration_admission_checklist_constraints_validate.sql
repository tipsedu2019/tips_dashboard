begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ops_registration_details
  validate constraint ops_registration_details_admission_checklist_exact_v1;

alter table public.ops_registration_admission_batches
  validate constraint ops_registration_admission_batches_invoice_evidence_v2;

alter table public.ops_registration_admission_batches
  validate constraint ops_registration_admission_batches_payment_evidence_v2;

commit;
