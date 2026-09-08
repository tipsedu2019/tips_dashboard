begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
alter table dashboard_private.notification_rules
  validate constraint notification_rules_word_retest_chat_retired_check;
commit;
