set local lock_timeout = '5s';

alter table public.textbooks
  add column if not exists school_levels text[] not null default '{}'::text[],
  add column if not exists grade_levels text[] not null default '{}'::text[];

-- textbook_taxonomy_backfill
do $$
declare
  textbook_row record;
  source_text text;
  grade_match text[];
  normalized_grade text;
  normalized_school text;
  next_school_levels text[];
  next_grade_levels text[];
begin
  for textbook_row in
    select * from public.textbooks order by id
  loop
    select coalesce(array_agg(candidate.value order by candidate.ordinality), '{}'::text[])
      into next_school_levels
    from unnest(array['elementary', 'middle', 'high']::text[]) with ordinality as candidate(value, ordinality)
    where candidate.value = any(coalesce(textbook_row.school_levels, '{}'::text[]));

    select coalesce(array_agg(candidate.value order by candidate.ordinality), '{}'::text[])
      into next_grade_levels
    from unnest(array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[]) with ordinality as candidate(value, ordinality)
    where candidate.value = any(coalesce(textbook_row.grade_levels, '{}'::text[]));

    if cardinality(next_school_levels) > 0 or cardinality(next_grade_levels) > 0 then
      if next_grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[] then
        next_school_levels := array_append(next_school_levels, 'elementary');
      end if;
      if next_grade_levels && array['m1', 'm2', 'm3']::text[] then
        next_school_levels := array_append(next_school_levels, 'middle');
      end if;
      if next_grade_levels && array['h1', 'h2', 'h3']::text[] then
        next_school_levels := array_append(next_school_levels, 'high');
      end if;
    else
      normalized_grade := case
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e1', '초1') then 'e1'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e2', '초2') then 'e2'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e3', '초3') then 'e3'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e4', '초4') then 'e4'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e5', '초5') then 'e5'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('e6', '초6') then 'e6'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('m1', '중1') then 'm1'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('m2', '중2') then 'm2'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('m3', '중3') then 'm3'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('h1', '고1') then 'h1'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('h2', '고2') then 'h2'
        when lower(btrim(coalesce(textbook_row.grade_level, ''))) in ('h3', '고3') then 'h3'
        else null
      end;

      normalized_school := case
        when lower(btrim(coalesce(textbook_row.school_level, ''))) in ('elementary', '초등', '초') then 'elementary'
        when lower(btrim(coalesce(textbook_row.school_level, ''))) in ('middle', '중등', '중') then 'middle'
        when lower(btrim(coalesce(textbook_row.school_level, ''))) in ('high', '고등', '고') then 'high'
        else null
      end;

      source_text := coalesce(textbook_row.category, '') || ' ' || coalesce(textbook_row.title, textbook_row.name, '');
      if normalized_grade is null then
        grade_match := regexp_match(source_text, '(초|중|고)\s*([1-6])');
        if grade_match is not null then
          normalized_grade := case grade_match[1]
            when '초' then 'e' || grade_match[2]
            when '중' then 'm' || grade_match[2]
            when '고' then 'h' || grade_match[2]
          end;
          if normalized_grade not in ('e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3') then
            normalized_grade := null;
          end if;
        end if;
      end if;

      if normalized_grade is not null then
        next_grade_levels := array[normalized_grade]::text[];
        next_school_levels := array[
          case left(normalized_grade, 1)
            when 'e' then 'elementary'
            when 'm' then 'middle'
            else 'high'
          end
        ]::text[];
      else
        if normalized_school is null then
          normalized_school := case
            when source_text ~ '(초등|초)' then 'elementary'
            when source_text ~ '(중등|중)' then 'middle'
            when source_text ~ '(고등|고)' then 'high'
            else null
          end;
        end if;

        if normalized_school is not null then
          next_school_levels := array[normalized_school]::text[];
          next_grade_levels := case normalized_school
            when 'elementary' then array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[]
            when 'middle' then array['m1', 'm2', 'm3']::text[]
            else array['h1', 'h2', 'h3']::text[]
          end;
        else
          next_school_levels := array['elementary', 'middle', 'high']::text[];
          next_grade_levels := array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[];
        end if;
      end if;
    end if;

    select coalesce(array_agg(candidate.value order by candidate.ordinality), '{}'::text[])
      into next_school_levels
    from unnest(array['elementary', 'middle', 'high']::text[]) with ordinality as candidate(value, ordinality)
    where candidate.value = any(next_school_levels);

    if 'elementary' = any(next_school_levels)
       and not (next_grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[]) then
      next_grade_levels := next_grade_levels || array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[];
    end if;
    if 'middle' = any(next_school_levels)
       and not (next_grade_levels && array['m1', 'm2', 'm3']::text[]) then
      next_grade_levels := next_grade_levels || array['m1', 'm2', 'm3']::text[];
    end if;
    if 'high' = any(next_school_levels)
       and not (next_grade_levels && array['h1', 'h2', 'h3']::text[]) then
      next_grade_levels := next_grade_levels || array['h1', 'h2', 'h3']::text[];
    end if;

    select coalesce(array_agg(candidate.value order by candidate.ordinality), '{}'::text[])
      into next_grade_levels
    from unnest(array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[]) with ordinality as candidate(value, ordinality)
    where candidate.value = any(next_grade_levels);

    update public.textbooks
    set subject = case
          when lower(btrim(coalesce(textbook_row.subject, ''))) in ('english', '영어') then 'english'
          when lower(btrim(coalesce(textbook_row.subject, ''))) in ('math', '수학') then 'math'
          else 'other'
        end,
        school_levels = next_school_levels,
        grade_levels = next_grade_levels,
        school_level = next_school_levels[1],
        grade_level = next_grade_levels[1],
        sub_subject = coalesce(
          nullif(btrim(textbook_row.sub_subject), ''),
          nullif(btrim(regexp_replace(coalesce(textbook_row.category, ''), '^(초등|중등|고등|초\s*[1-6]|중\s*[1-3]|고\s*[1-3])\s*', '')), ''),
          '기타'
        )
    where id = textbook_row.id;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.textbooks
    where subject not in ('english', 'math', 'other')
       or cardinality(school_levels) = 0
       or not (school_levels <@ array['elementary', 'middle', 'high']::text[])
       or cardinality(grade_levels) = 0
       or not (grade_levels <@ array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[])
       or (grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[] and not school_levels @> array['elementary']::text[])
       or (grade_levels && array['m1', 'm2', 'm3']::text[] and not school_levels @> array['middle']::text[])
       or (grade_levels && array['h1', 'h2', 'h3']::text[] and not school_levels @> array['high']::text[])
       or (school_levels @> array['elementary']::text[] and not grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[])
       or (school_levels @> array['middle']::text[] and not grade_levels && array['m1', 'm2', 'm3']::text[])
       or (school_levels @> array['high']::text[] and not grade_levels && array['h1', 'h2', 'h3']::text[])
       or btrim(coalesce(sub_subject, '')) = ''
  ) then
    raise exception 'textbook_taxonomy_backfill_failed';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'textbooks_subject_required' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_subject_required
      check (subject is not null and subject in ('english', 'math', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'textbooks_school_levels_required' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_school_levels_required
      check (cardinality(school_levels) > 0 and school_levels <@ array['elementary', 'middle', 'high']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'textbooks_grade_levels_required' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_grade_levels_required
      check (cardinality(grade_levels) > 0 and grade_levels <@ array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'textbooks_grade_school_consistency' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_grade_school_consistency
      check (
        (not (grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[]) or school_levels @> array['elementary']::text[])
        and (not (grade_levels && array['m1', 'm2', 'm3']::text[]) or school_levels @> array['middle']::text[])
        and (not (grade_levels && array['h1', 'h2', 'h3']::text[]) or school_levels @> array['high']::text[])
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'textbooks_school_grade_coverage' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_school_grade_coverage
      check (
        (not (school_levels @> array['elementary']::text[]) or grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[])
        and (not (school_levels @> array['middle']::text[]) or grade_levels && array['m1', 'm2', 'm3']::text[])
        and (not (school_levels @> array['high']::text[]) or grade_levels && array['h1', 'h2', 'h3']::text[])
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'textbooks_sub_subject_required' and conrelid = 'public.textbooks'::regclass) then
    alter table public.textbooks add constraint textbooks_sub_subject_required
      check (sub_subject is not null and btrim(sub_subject) <> '');
  end if;
end
$$;

insert into public.textbook_sub_subject_settings (subject, name, sort_order)
values
  ('english', '기타', 999),
  ('math', '기타', 999),
  ('other', '기타', 999)
on conflict (subject, name) do nothing;

notify pgrst, 'reload schema';
