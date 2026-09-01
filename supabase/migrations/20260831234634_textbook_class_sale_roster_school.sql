-- Preserve the complete selected class-sale roster search contract. This
-- replaces only the final class context function and adds the nullable
-- physical school field to its already-bounded selected-student projection.
create or replace function public.get_class_textbook_sale_context_v1(p_input jsonb)returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare result jsonb;v_class_id uuid;v_book_id uuid;v_location_id uuid;month text;begin
  perform dashboard_private.textbook_read_guard_v1();perform dashboard_private.textbook_context_strings_v1(p_input,array['classId','textbookId','chargeMonth','locationId']);
  if exists(select 1 from unnest(array['classId','textbookId','locationId'])k where p_input->>k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')then raise exception 'textbook_class_context_input_invalid'using errcode='22023';end if;
  v_class_id:=(p_input->>'classId')::uuid;v_book_id:=(p_input->>'textbookId')::uuid;v_location_id:=(p_input->>'locationId')::uuid;
  month:=left(dashboard_private.textbook_trim_v1(p_input->>'chargeMonth'),7);if month !~ '^\d{4}-\d{2}$'then month:=to_char(now()at time zone 'UTC','YYYY-MM');end if;
  if not exists(select 1 from public.classes c where c.id=v_class_id)or not exists(select 1 from public.textbooks b where b.id=v_book_id)or not exists(select 1 from public.textbook_inventory_locations l where l.id=v_location_id)then raise exception 'textbook_class_context_unavailable'using errcode='22023';end if;
  with class_source as materialized(select c.id,c.name,c.student_ids,dashboard_private.textbook_context_roster_v1(c.student_ids)roster from public.classes c where c.id=v_class_id),
  roster as materialized(select v.id,v.ord from class_source c cross join lateral jsonb_array_elements_text(c.roster)with ordinality v(id,ord)),
  students as materialized(select s.id,s.name,s.grade,s.school from public.students s where s.id::text in(select id from roster)),
  duplicates as materialized(select l.* from public.textbook_sale_lines l left join public.textbook_sales s on s.id=l.sale_id join public.textbooks b on b.id=l.textbook_id where l.textbook_id=v_book_id and coalesce(l.class_id,s.class_id)=v_class_id
    and lower(dashboard_private.textbook_trim_v1(b.status))not in('inactive','미사용')and l.copy_scope<>'teacher'and l.status not in('cancelled','returned','excluded')
    and case when left(dashboard_private.textbook_trim_v1(coalesce(nullif(l.charge_month,''),s.charge_month,'')),7)~'^\d{4}-\d{2}$'then left(dashboard_private.textbook_trim_v1(coalesce(nullif(l.charge_month,''),s.charge_month,'')),7)else to_char(now()at time zone 'UTC','YYYY-MM')end=month),
  duplicate_students as(select distinct student_id from duplicates where student_id is not null)
  select jsonb_build_object('input',jsonb_build_object('classId',v_class_id,'textbookId',v_book_id,'locationId',v_location_id,'chargeMonth',month),'class',jsonb_build_object('id',c.id,'name',c.name,'student_ids',c.student_ids),
    'enrolledStudentIds',c.roster,'students',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from students s),'[]'),
    'missingStudentIds',coalesce((select jsonb_agg(r.id order by r.ord)from roster r where not exists(select 1 from students s where s.id::text=r.id)),'[]'),
    'textbook',dashboard_private.textbook_workflow_book_v1(v_book_id),'location',dashboard_private.textbook_workflow_location_v1(v_location_id),
    'inventory',public.get_textbook_inventory_balance_v1(jsonb_build_object('textbookIds',jsonb_build_array(v_book_id),'locationId',v_location_id))#>'{rows,0}',
    'duplicateLines',coalesce((select jsonb_agg(to_jsonb(d)order by d.id)from duplicates d),'[]'),'duplicateSales',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from public.textbook_sales s where s.id in(select sale_id from duplicates)),'[]'),
    'duplicateLineIds',coalesce((select jsonb_agg(id order by id)from duplicates),'[]'),'duplicateLineCount',(select count(*)from duplicates),
    'duplicateStudentIds',coalesce((select jsonb_agg(student_id order by student_id)from duplicate_students),'[]'),'duplicateCount',coalesce(nullif((select count(*)from duplicate_students),0),(select count(*)from duplicates)),'complete',true)into result from class_source c;return result;
end $$;

revoke all on function public.get_class_textbook_sale_context_v1(jsonb) from public, anon;
grant execute on function public.get_class_textbook_sale_context_v1(jsonb) to authenticated;
