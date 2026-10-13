-- Re-point the SHS source rows from the legacy curriculum GH-CCP-2020 to GH-SHS-2023 (decision D-17), the same step that was done for JHS.
-- Why: a curriculum can only be activated and loaded against its own approved sources, and the SHS PDFs are registered under GH-CCP-2020.
-- Step 1: run the first select (read only). Expect SHS rows only (about 32 ACTIVE PDFs and 1 index page); nothing for JHS or Primary.
select r.status, count(*) as rows
from quizbox_sources.registry r
join public.curricula c on c.id = r.curriculum_id
where c.code = 'GH-CCP-2020' and r.education_level ilike '%SHS%'
group by r.status order by r.status;

-- Step 2: the move. Guarded: it stops unless the numbers are what Step 1 should show, and it touches nothing else.
do $repoint$
declare v_old uuid; v_new uuid; v_n integer; v_docs integer;
begin
  select id into v_old from public.curricula where code = 'GH-CCP-2020';
  select id into v_new from public.curricula where code = 'GH-SHS-2023';
  if v_old is null or v_new is null then raise exception 'CURRICULUM_NOT_FOUND'; end if;
  select count(*) into v_n from quizbox_sources.registry where curriculum_id = v_old and education_level ilike '%SHS%';
  if v_n = 0 then raise notice 'Nothing to move.'; return; end if;
  if v_n > 40 then raise exception 'UNEXPECTED_ROW_COUNT_%', v_n; end if;
  if exists (select 1 from quizbox_sources.registry where curriculum_id = v_old and education_level ilike '%SHS%'
             and market_id <> (select market_id from public.curricula where id = v_new)) then raise exception 'MARKET_MISMATCH'; end if;
  update public.source_documents d set curriculum_id = v_new
   where d.id in (select source_document_id from quizbox_sources.registry where curriculum_id = v_old and education_level ilike '%SHS%' and source_document_id is not null);
  get diagnostics v_docs = row_count;
  update quizbox_sources.registry set curriculum_id = v_new where curriculum_id = v_old and education_level ilike '%SHS%';
  raise notice 'Moved % registry rows and % source documents to GH-SHS-2023.', v_n, v_docs;
end $repoint$;

-- Step 3 (read only): expect the SHS rows under GH-SHS-2023 and none left under GH-CCP-2020.
select c.code, r.status, count(*) as rows
from quizbox_sources.registry r join public.curricula c on c.id = r.curriculum_id
where r.education_level ilike '%SHS%' group by c.code, r.status order by c.code, r.status;
