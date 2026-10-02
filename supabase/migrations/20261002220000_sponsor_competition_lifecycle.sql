-- Prepared only. Requires both market migrations; no production activation.
begin;
create schema quizbox_competition;
revoke all on schema quizbox_competition from public, anon, authenticated;

create table quizbox_competition.sponsor_organizations (
  sponsor_id uuid primary key references public.sponsor_profiles(id),
  organization_type text not null,
  country_id uuid not null references public.countries(id),
  market_id uuid not null references public.markets(id),
  website text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table quizbox_competition.organization_members (
  sponsor_id uuid not null references quizbox_competition.sponsor_organizations(sponsor_id),
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('sponsor_owner','sponsor_admin','sponsor_editor','sponsor_viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (sponsor_id,user_id)
);
create index sponsor_member_user on quizbox_competition.organization_members(user_id) where active;

create table quizbox_competition.drafts (
  competition_id uuid primary key references public.competitions(id),
  sponsor_id uuid not null references quizbox_competition.sponsor_organizations(sponsor_id),
  created_by uuid not null references public.profiles(id),
  content_context_id uuid not null references public.content_contexts(id),
  configuration jsonb not null check (jsonb_typeof(configuration)='object'),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(competition_id,sponsor_id)
);
create index sponsor_draft_owner on quizbox_competition.drafts(sponsor_id,created_at);
create table quizbox_competition.documents (
  id uuid primary key references public.source_documents(id),
  competition_id uuid not null references quizbox_competition.drafts(competition_id),
  version integer not null check(version>0),
  checksum text not null check(length(checksum)=64),
  ingestion_status text not null default 'UPLOADED' check(ingestion_status in ('UPLOADED','PROCESSING','EXTRACTED','READY_FOR_GENERATION','FAILED')),
  error_code text, author text, publisher text,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,competition_id)
);
create table quizbox_competition.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references quizbox_competition.documents(id),
  position integer not null check(position>=0),
  source_text text not null check(length(btrim(source_text))>0),
  page integer check(page>0), chapter text, section text, heading text,
  checksum text not null check(length(checksum)=64),
  created_at timestamptz not null default now(),
  unique(document_id,position), unique(id,document_id)
);
create table quizbox_competition.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_competition.drafts(competition_id),
  created_by uuid not null references public.profiles(id),
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object'),
  provider text not null, model text not null,
  requested_count integer not null check(requested_count between 1 and 500),
  started_at timestamptz, completed_at timestamptz, error_code text,
  created_at timestamptz not null default now(),
  unique(id,competition_id)
);
create index sponsor_job_competition on quizbox_competition.generation_jobs(competition_id,created_at);
create table quizbox_competition.candidates (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_competition.drafts(competition_id),
  job_id uuid not null,
  source_document_id uuid not null,
  source_chunk_id uuid not null,
  market_id uuid references public.markets(id),
  curriculum_id uuid references public.curricula(id),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'GENERATED' check(status in ('GENERATED','ASSIGNED_FOR_REVIEW','UNDER_REVIEW','REVISION_REQUIRED','APPROVED','REJECTED','PUBLISHED')),
  question_id uuid references public.questions(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(job_id,competition_id) references quizbox_competition.generation_jobs(id,competition_id),
  foreign key(source_document_id,competition_id) references quizbox_competition.documents(id,competition_id),
  foreign key(source_chunk_id,source_document_id) references quizbox_competition.chunks(id,document_id),
  unique(id,competition_id)
);
create index sponsor_candidate_queue on quizbox_competition.candidates(competition_id,status,created_at);
create table quizbox_competition.review_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references quizbox_competition.candidates(id),
  reviewer_id uuid not null references public.profiles(id),
  -- Existing SME work/ledger identity is retained in this snapshot. No new rates or currency.
  assignment_id uuid not null,
  decision text not null check(decision in ('APPROVE','REQUEST_REVISION','REJECT')),
  previous_state text not null, new_state text not null, notes text not null,
  started_at timestamptz not null, completed_at timestamptz not null,
  policy_context_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  check(completed_at>=started_at), unique(assignment_id)
);
create table quizbox_competition.bank_items (
  competition_id uuid not null references quizbox_competition.drafts(competition_id),
  candidate_id uuid not null,
  question_version_id uuid not null references public.question_versions(id),
  position integer not null check(position>=0), included boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(candidate_id,competition_id) references quizbox_competition.candidates(id,competition_id),
  primary key(competition_id,candidate_id), unique(competition_id,position)
);
create table quizbox_competition.snapshots (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_competition.drafts(competition_id),
  version integer not null check(version>0),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  checksum text not null check(length(checksum)=64),
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  assessment_id uuid not null references public.assessments(id),
  unique(competition_id,version), unique(id,competition_id)
);
create table quizbox_competition.participations (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null,
  snapshot_id uuid not null,
  participant_id uuid not null references public.profiles(id),
  attempt_id uuid not null unique references public.attempts(id),
  attempt_number integer not null check(attempt_number>0),
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(snapshot_id,competition_id) references quizbox_competition.snapshots(id,competition_id),
  unique(competition_id,participant_id,attempt_number)
);
create index sponsor_participant_snapshot on quizbox_competition.participations(snapshot_id,participant_id);

create function quizbox_competition.reject_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IMMUTABLE_COMPETITION_RECORD'; end $$;
create trigger immutable_snapshot before update or delete on quizbox_competition.snapshots for each row execute function quizbox_competition.reject_mutation();
create trigger immutable_review_event before update or delete on quizbox_competition.review_events for each row execute function quizbox_competition.reject_mutation();
create trigger immutable_source_chunk before update or delete on quizbox_competition.chunks for each row execute function quizbox_competition.reject_mutation();
create trigger immutable_participation before update or delete on quizbox_competition.participations for each row execute function quizbox_competition.reject_mutation();
revoke all on function quizbox_competition.reject_mutation() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['sponsor_organizations','organization_members','drafts','documents','chunks','generation_jobs','candidates','review_events','bank_items','snapshots','participations'] loop
    execute format('alter table quizbox_competition.%I enable row level security',t);
    execute format('revoke all on quizbox_competition.%I from public,anon,authenticated',t);
  end loop;
end $$;
-- Fail-closed private persistence: no browser grants or public write RPCs yet.
-- Authenticated adapters and market-aware policies are a separate activation gate.
commit;
