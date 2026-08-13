begin;
select plan(2);

select has_schema('public', 'baseline restores the public schema');
select has_table('public', 'classes', 'baseline restores the scoped classes relation');

select * from finish();
rollback;
