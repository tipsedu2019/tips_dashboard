revoke truncate, references, trigger on public.ops_tasks from authenticated;
revoke truncate, references, trigger on public.ops_task_comments from authenticated;
revoke truncate, references, trigger on public.ops_task_events from authenticated;
revoke truncate, references, trigger on public.ops_task_attachments from authenticated;
revoke truncate, references, trigger on public.ops_registration_details from authenticated;
revoke truncate, references, trigger on public.ops_withdrawal_details from authenticated;
revoke truncate, references, trigger on public.ops_transfer_details from authenticated;
revoke truncate, references, trigger on public.ops_word_retests from authenticated;

grant select, insert, update, delete on public.ops_tasks to authenticated;
grant select, insert, update, delete on public.ops_task_comments to authenticated;
grant select, insert, update, delete on public.ops_task_events to authenticated;
grant select, insert, update, delete on public.ops_task_attachments to authenticated;
grant select, insert, update, delete on public.ops_registration_details to authenticated;
grant select, insert, update, delete on public.ops_withdrawal_details to authenticated;
grant select, insert, update, delete on public.ops_transfer_details to authenticated;
grant select, insert, update, delete on public.ops_word_retests to authenticated;
