alter table public.ops_word_retests
  add column if not exists total_question_count numeric(8,2),
  add column if not exists score_out_of_100 numeric(8,2),
  add column if not exists cutoff_question_count numeric(8,2);
