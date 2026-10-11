-- READ-ONLY. One row. Every column must be true (the last one being true means the engine is not applied yet).
select
  to_regprocedure('quizbox_sme.has_capability(text)') is not null as has_capability,
  to_regprocedure('quizbox_market.is_super()') is not null as is_super,
  to_regprocedure('public.qb_content_factory_import(jsonb)') is not null as factory_import,
  to_regclass('quizbox_factory.assignment_events') is not null as assignment_events,
  to_regprocedure('quizbox_factory.reviewer_money(uuid,text[],timestamptz)') is not null as reviewer_money,
  to_regprocedure('public.qb_publish_assignment(uuid,text,text,uuid[],integer,text,text,uuid[],text,integer,integer,timestamptz,timestamptz,uuid[],uuid,uuid)') is not null as publish_assignment,
  to_regclass('public.classes') is not null as classes,
  to_regclass('public.assignments') is not null as assignments,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sme_review_assignments' and column_name = 'released_at') as released_at,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'questions' and column_name = 'content_origin') as content_origin,
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sme_domain_assignments' and column_name = 'specialization') as specialization,
  to_regclass('public.question_topic_links') is null as engine_not_applied_yet;
