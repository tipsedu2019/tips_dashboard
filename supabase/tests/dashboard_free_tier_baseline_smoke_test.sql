begin;
select plan(2);

select has_schema('supabase_migrations', 'baseline restores migration ledger schema');
select has_table('public', 'profiles', 'baseline restores the scoped profiles relation');

select * from finish();
rollback;
