begin;

create schema quiz_private;
revoke all on schema quiz_private from public, anon, authenticated;

create table public.quiz_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table quiz_private.quizzes (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null,
  description jsonb not null,
  language text not null check (language in ('none', 'kn', 'hi')),
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  status text not null check (status in ('draft', 'live', 'closed')),
  questions jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);

create table quiz_private.attempts (
  id uuid primary key,
  quiz_id uuid not null references quiz_private.quizzes(id),
  token_hash bytea not null,
  name text not null,
  quiz jsonb not null,
  time_multiplier integer not null check (time_multiplier in (0, 1, 2, 5, 10)),
  started_at timestamptz not null,
  deadline_at timestamptz,
  answers jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  submitted_at timestamptz,
  elapsed_seconds integer,
  reason text check (reason in ('manual', 'timeout')),
  score numeric,
  max_score numeric,
  manual_count integer
);

create index quiz_attempts_pending_deadline
  on quiz_private.attempts (deadline_at)
  where submitted_at is null and deadline_at is not null;

create index quiz_attempts_results
  on quiz_private.attempts (quiz_id, submitted_at desc, id desc)
  where submitted_at is not null;

alter table public.quiz_admins enable row level security;
alter table quiz_private.quizzes enable row level security;
alter table quiz_private.attempts enable row level security;
revoke all on public.quiz_admins, quiz_private.quizzes, quiz_private.attempts
  from public, anon, authenticated;

create function quiz_private.require_admin()
returns void language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.quiz_admins where user_id = auth.uid()) then
    raise exception 'quiz_admin_required' using errcode = '42501';
  end if;
end;
$$;

create function quiz_private.has_text(p_text text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_text ~ '[^[:space:]]', false);
$$;

create function quiz_private.localized_valid(p_value jsonb, p_limit integer)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    return false;
  end if;

  return not exists (
    select 1
    from jsonb_each(p_value) as translation(language, content)
    where language not in ('en', 'kn', 'hi')
       or jsonb_typeof(content) <> 'string'
       or length(content #>> '{}') > p_limit
  );
end;
$$;

create function quiz_private.question_set(p_questions jsonb, p_live boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  question jsonb;
  option_item jsonb;
  answer_item jsonb;
  question_id uuid;
  option_id uuid;
  question_ids uuid[] := '{}';
  option_ids uuid[];
  answer_ids uuid[];
  question_type text;
  question_points numeric;
  clean_questions jsonb := '[]';
  clean_options jsonb;
  clean_answers jsonb;
  answer_text text;
begin
  if jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'quiz_invalid_questions' using errcode = '22023';
  end if;
  if jsonb_array_length(p_questions) > 100
     or (p_live and jsonb_array_length(p_questions) = 0) then
    raise exception 'quiz_invalid_questions' using errcode = '22023';
  end if;

  for question in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(question) <> 'object'
       or jsonb_typeof(question->'id') is distinct from 'string'
       or not quiz_private.localized_valid(question->'prompt', 2000)
       or jsonb_typeof(question->'required') is distinct from 'boolean'
       or jsonb_typeof(question->'points') is distinct from 'number'
       or jsonb_typeof(question->'options') is distinct from 'array'
       or jsonb_typeof(question->'correct') is distinct from 'array' then
      raise exception 'quiz_invalid_questions' using errcode = '22023';
    end if;

    question_id := (question->>'id')::uuid;
    question_type := question->>'type';
    question_points := (question->>'points')::numeric;
    if question_id = any(question_ids)
       or question_type is null or question_type not in ('radio', 'checkbox', 'short', 'long')
       or question_points not between 0 and 1000
       or question_points <> round(question_points, 2)
       or jsonb_array_length(question->'options') > 30
       or jsonb_array_length(question->'correct') > 30
       or (p_live and not quiz_private.has_text(question #>> '{prompt,en}')) then
      raise exception 'quiz_invalid_questions' using errcode = '22023';
    end if;
    question_ids := array_append(question_ids, question_id);
    clean_options := '[]';
    clean_answers := '[]';
    option_ids := '{}';
    answer_ids := '{}';

    if question_type in ('radio', 'checkbox') then
      if p_live and jsonb_array_length(question->'options') < 2 then
        raise exception 'quiz_invalid_options' using errcode = '22023';
      end if;
      for option_item in select value from jsonb_array_elements(question->'options') loop
        if jsonb_typeof(option_item) <> 'object'
           or jsonb_typeof(option_item->'id') is distinct from 'string'
           or not quiz_private.localized_valid(option_item->'label', 500)
           or (p_live and not quiz_private.has_text(option_item #>> '{label,en}')) then
          raise exception 'quiz_invalid_options' using errcode = '22023';
        end if;
        option_id := (option_item->>'id')::uuid;
        if option_id = any(option_ids) then
          raise exception 'quiz_invalid_options' using errcode = '22023';
        end if;
        option_ids := array_append(option_ids, option_id);
        clean_options := clean_options || jsonb_build_object('id', option_id, 'label', option_item->'label');
      end loop;
      if (question_type = 'radio' and jsonb_array_length(question->'correct') > 1)
         or (p_live and jsonb_array_length(question->'correct') = 0) then
        raise exception 'quiz_invalid_key' using errcode = '22023';
      end if;
      for answer_item in select value from jsonb_array_elements(question->'correct') loop
        if jsonb_typeof(answer_item) <> 'string' then
          raise exception 'quiz_invalid_key' using errcode = '22023';
        end if;
        option_id := (answer_item #>> '{}')::uuid;
        if not (option_id = any(option_ids)) or option_id = any(answer_ids) then
          raise exception 'quiz_invalid_key' using errcode = '22023';
        end if;
        answer_ids := array_append(answer_ids, option_id);
        clean_answers := clean_answers || to_jsonb(option_id);
      end loop;
    else
      for answer_item in select value from jsonb_array_elements(question->'correct') loop
        answer_text := answer_item #>> '{}';
        if jsonb_typeof(answer_item) <> 'string' or length(answer_text) > 5000 then
          raise exception 'quiz_invalid_key' using errcode = '22023';
        end if;
        if quiz_private.has_text(answer_text) then
          clean_answers := clean_answers || answer_item;
        end if;
      end loop;
    end if;

    clean_questions := clean_questions || jsonb_build_object(
      'id', question_id, 'type', question_type, 'prompt', question->'prompt',
      'required', question->'required', 'points', question_points,
      'options', clean_options, 'correct', clean_answers
    );
  end loop;
  return clean_questions;
exception when invalid_text_representation then
  raise exception 'quiz_invalid_questions' using errcode = '22023';
end;
$$;

create function quiz_private.summary(p_quiz quiz_private.quizzes)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_quiz.id, 'title', p_quiz.title, 'description', p_quiz.description,
    'language', p_quiz.language, 'duration_minutes', p_quiz.duration_minutes,
    'question_count', jsonb_array_length(p_quiz.questions)
  );
$$;

create function quiz_private.without_keys(p_quiz jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select p_quiz || jsonb_build_object('questions', coalesce((
    select jsonb_agg(question - 'correct' order by position)
    from jsonb_array_elements(p_quiz->'questions') with ordinality as q(question, position)
  ), '[]'::jsonb));
$$;

create function quiz_private.clean_answers(p_quiz jsonb, p_answers jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  question jsonb;
  option_value jsonb;
  response jsonb;
  normalized jsonb := '{}'::jsonb;
  seen_options jsonb;
  question_id text;
  question_type text;
begin
  if jsonb_typeof(p_answers) is distinct from 'object'
     or octet_length(p_answers::text) > 2200000 then
    raise exception 'quiz_invalid_answers' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_answers) as k(question_id)
    where not exists (
      select 1 from jsonb_array_elements(p_quiz->'questions') as q(item)
      where q.item->>'id' = k.question_id
    )
  ) then
    raise exception 'quiz_invalid_answers' using errcode = '22023';
  end if;

  for question in select value from jsonb_array_elements(p_quiz->'questions') loop
    question_id := question->>'id';
    question_type := question->>'type';
    response := p_answers->question_id;
    if response is null or response = 'null'::jsonb then
      continue;
    end if;

    if question_type = 'checkbox' then
      if jsonb_typeof(response) <> 'array' then
        raise exception 'quiz_invalid_answers' using errcode = '22023';
      end if;
      if jsonb_array_length(response) > 30 then
        raise exception 'quiz_invalid_answers' using errcode = '22023';
      end if;
      seen_options := '[]';
      for option_value in select value from jsonb_array_elements(response) loop
        if not exists (
          select 1 from jsonb_array_elements(question->'options') as o(item)
          where o.item->'id' = option_value
        ) then
          raise exception 'quiz_invalid_answers' using errcode = '22023';
        end if;
        if not (seen_options @> jsonb_build_array(option_value)) then
          seen_options := seen_options || option_value;
        end if;
      end loop;
      if seen_options = '[]' then
        continue;
      end if;
      response := seen_options;
    elsif jsonb_typeof(response) <> 'string' or length(response #>> '{}') > 5000 then
      raise exception 'quiz_invalid_answers' using errcode = '22023';
    elsif not quiz_private.has_text(response #>> '{}') then
      continue;
    elsif question_type = 'radio' and not exists (
      select 1 from jsonb_array_elements(question->'options') as o(item)
      where o.item->'id' = response
    ) then
      raise exception 'quiz_invalid_answers' using errcode = '22023';
    end if;

    normalized := normalized || jsonb_build_object(question_id, response);
  end loop;
  return normalized;
end;
$$;

create function quiz_private.normalized_text(p_text text)
returns text language sql immutable set search_path = '' as $$
  select lower(normalize(regexp_replace(p_text, '^[[:space:]]+|[[:space:]]+$', '', 'g')));
$$;

create function quiz_private.finish_attempt(
  p_attempt quiz_private.attempts, p_when timestamptz, p_reason text
)
returns quiz_private.attempts language plpgsql set search_path = '' as $$
declare
  question jsonb;
  answer jsonb;
  key_items jsonb;
  points numeric;
  total_score numeric := 0;
  possible_score numeric := 0;
  manual_questions integer := 0;
  correct_answer boolean;
  result quiz_private.attempts;
begin
  if p_attempt.submitted_at is not null then
    return p_attempt;
  end if;
  for question in select value from jsonb_array_elements(p_attempt.quiz->'questions') loop
    answer := p_attempt.answers->(question->>'id');
    key_items := question->'correct';
    if jsonb_array_length(key_items) = 0 then
      if answer is not null then
        manual_questions := manual_questions + 1;
      end if;
      continue;
    end if;
    points := (question->>'points')::numeric;
    possible_score := possible_score + points;
    if answer is null then
      continue;
    end if;
    case question->>'type'
      when 'radio' then
        correct_answer := answer = key_items->0;
      when 'checkbox' then
        correct_answer := answer @> key_items and key_items @> answer;
      else
        correct_answer := exists (
          select 1 from jsonb_array_elements_text(key_items) as k(accepted)
          where quiz_private.normalized_text(k.accepted) = quiz_private.normalized_text(answer #>> '{}')
        );
    end case;
    if correct_answer then
      total_score := total_score + points;
    end if;
  end loop;

  update quiz_private.attempts
  set answers = p_attempt.answers, revision = p_attempt.revision,
      submitted_at = p_when,
      elapsed_seconds = greatest(0, floor(extract(epoch from (p_when - p_attempt.started_at))))::integer,
      reason = p_reason, score = total_score, max_score = possible_score, manual_count = manual_questions
  where id = p_attempt.id
  returning * into result;
  return result;
end;
$$;

create function quiz_private.expire_attempts(p_quiz_id uuid, p_limit integer)
returns void language plpgsql set search_path = '' as $$
declare
  expired quiz_private.attempts;
  cutoff timestamptz := clock_timestamp();
begin
  for expired in
    select a.* from quiz_private.attempts a
    where a.submitted_at is null and a.deadline_at <= cutoff
      and (p_quiz_id is null or a.quiz_id = p_quiz_id)
    order by a.deadline_at
    limit p_limit
    for update skip locked
  loop
    perform quiz_private.finish_attempt(expired, expired.deadline_at, 'timeout');
  end loop;
end;
$$;

create function quiz_private.attempt_state(p_attempt quiz_private.attempts)
returns jsonb language sql volatile set search_path = '' as $$
  select jsonb_build_object(
    'id', p_attempt.id, 'quiz', quiz_private.without_keys(p_attempt.quiz),
    'answers', p_attempt.answers, 'revision', p_attempt.revision,
    'started_at', p_attempt.started_at, 'deadline_at', p_attempt.deadline_at,
    'submitted_at', p_attempt.submitted_at, 'elapsed_seconds', p_attempt.elapsed_seconds,
    'reason', p_attempt.reason, 'server_now', clock_timestamp(),
    'time_multiplier', p_attempt.time_multiplier
  );
$$;

create function quiz_private.attempt_action(
  p_attempt_id uuid, p_token uuid, p_action text, p_answers jsonb, p_revision integer
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result quiz_private.attempts;
  action_time timestamptz;
begin
  select a.* into result
  from quiz_private.attempts a
  where a.id = p_attempt_id and a.token_hash = sha256(convert_to(p_token::text, 'UTF8'))
  for update of a;
  if not found then
    raise exception 'quiz_attempt_not_found' using errcode = 'P0002';
  end if;
  if result.submitted_at is not null then
    return quiz_private.attempt_state(result);
  end if;

  action_time := clock_timestamp();
  if result.deadline_at <= action_time then
    result := quiz_private.finish_attempt(result, result.deadline_at, 'timeout');
    return quiz_private.attempt_state(result);
  end if;
  if p_action = 'read' then
    return quiz_private.attempt_state(result);
  end if;
  if p_revision is null or p_revision < 0 then
    raise exception 'quiz_invalid_revision' using errcode = '22023';
  end if;

  if p_revision > result.revision then
    result.answers := quiz_private.clean_answers(result.quiz, p_answers);
    result.revision := p_revision;
  end if;

  if p_action = 'submit' then
    if exists (
      select 1 from jsonb_array_elements(result.quiz->'questions') as q(question)
      where (question->>'required')::boolean and not (result.answers ? (question->>'id'))
    ) then
      raise exception 'quiz_required_answers' using errcode = '22023';
    end if;
    result := quiz_private.finish_attempt(result, action_time, 'manual');
  else
    update quiz_private.attempts
    set answers = result.answers, revision = result.revision
    where id = result.id and revision < result.revision;
  end if;
  return quiz_private.attempt_state(result);
end;
$$;

create function public.quiz_list_live()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(quiz_private.summary(q) order by q.updated_at desc, q.id), '[]'::jsonb)
  from quiz_private.quizzes q where q.status = 'live';
$$;

create function public.quiz_start(
  p_quiz_id uuid, p_attempt_id uuid, p_token uuid, p_name text, p_time_multiplier integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result quiz_private.attempts;
  selected quiz_private.quizzes;
  start_time timestamptz;
begin
  if p_attempt_id is null or p_token is null then
    raise exception 'quiz_invalid_attempt' using errcode = '22023';
  end if;
  if p_time_multiplier is null or p_time_multiplier not in (0, 1, 2, 5, 10) then
    raise exception 'quiz_invalid_time' using errcode = '22023';
  end if;
  if not quiz_private.has_text(p_name) or length(p_name) > 120 then
    raise exception 'quiz_invalid_name' using errcode = '22023';
  end if;

  select * into result from quiz_private.attempts where id = p_attempt_id;
  if not found then
    select * into selected
    from quiz_private.quizzes where id = p_quiz_id and status = 'live'
    for share;
    if not found then
      raise exception 'quiz_not_live' using errcode = 'P0002';
    end if;
    start_time := clock_timestamp();
    insert into quiz_private.attempts (
      id, quiz_id, token_hash, name, quiz, time_multiplier, started_at, deadline_at
    )
    values (
      p_attempt_id, selected.id, sha256(convert_to(p_token::text, 'UTF8')), btrim(p_name),
      quiz_private.summary(selected) || jsonb_build_object('questions', selected.questions),
      p_time_multiplier, start_time,
      case when p_time_multiplier > 0
        then start_time + make_interval(mins => selected.duration_minutes * p_time_multiplier)
      end
    )
    on conflict (id) do nothing;
    select * into result from quiz_private.attempts where id = p_attempt_id;
  end if;
  if result.quiz_id is distinct from p_quiz_id then
    raise exception 'quiz_attempt_not_found' using errcode = 'P0002';
  end if;
  return quiz_private.attempt_action(p_attempt_id, p_token, 'read', null, null);
end;
$$;

create function public.quiz_attempt(p_attempt_id uuid, p_token uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select quiz_private.attempt_action(p_attempt_id, p_token, 'read', null, null);
$$;

create function public.quiz_save(p_attempt_id uuid, p_token uuid, p_answers jsonb, p_revision integer)
returns jsonb language sql security definer set search_path = '' as $$
  select quiz_private.attempt_action(p_attempt_id, p_token, 'save', p_answers, p_revision);
$$;

create function public.quiz_submit(p_attempt_id uuid, p_token uuid, p_answers jsonb, p_revision integer)
returns jsonb language sql security definer set search_path = '' as $$
  select quiz_private.attempt_action(p_attempt_id, p_token, 'submit', p_answers, p_revision);
$$;

create function public.quiz_admin_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform quiz_private.require_admin();
  perform quiz_private.expire_attempts(null, null);
  return (
    select coalesce(jsonb_agg(
      quiz_private.summary(q) || jsonb_build_object(
        'status', q.status, 'updated_at', q.updated_at, 'submission_count', coalesce(a.total, 0)
      ) order by q.updated_at desc, q.id
    ), '[]'::jsonb)
    from quiz_private.quizzes q
    left join (
      select quiz_id, count(*) as total from quiz_private.attempts
      where submitted_at is not null group by quiz_id
    ) a on a.quiz_id = q.id
  );
end;
$$;

create function public.quiz_admin_get(p_quiz_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result quiz_private.quizzes;
begin
  perform quiz_private.require_admin();
  select * into result from quiz_private.quizzes where id = p_quiz_id;
  if not found then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  return to_jsonb(result);
end;
$$;

create function public.quiz_admin_save(p_quiz jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  quiz_id uuid;
  quiz_status text := p_quiz->>'status';
  quiz_language text := p_quiz->>'language';
  minutes numeric;
  questions jsonb;
begin
  perform quiz_private.require_admin();
  if jsonb_typeof(p_quiz) is distinct from 'object'
     or octet_length(p_quiz::text) > 3000000
     or not quiz_private.localized_valid(p_quiz->'title', 160)
     or not quiz_private.has_text(p_quiz #>> '{title,en}')
     or not quiz_private.localized_valid(p_quiz->'description', 4000)
     or quiz_language is null or quiz_language not in ('none', 'kn', 'hi')
     or quiz_status is null or quiz_status not in ('draft', 'live', 'closed')
     or jsonb_typeof(p_quiz->'duration_minutes') is distinct from 'number' then
    raise exception 'quiz_invalid_details' using errcode = '22023';
  end if;
  minutes := (p_quiz->>'duration_minutes')::numeric;
  if minutes not between 1 and 600 or minutes <> trunc(minutes) then
    raise exception 'quiz_invalid_details' using errcode = '22023';
  end if;

  quiz_id := coalesce((p_quiz->>'id')::uuid, gen_random_uuid());
  questions := quiz_private.question_set(p_quiz->'questions', quiz_status = 'live');
  insert into quiz_private.quizzes (id, title, description, language, duration_minutes, status, questions)
  values (quiz_id, p_quiz->'title', p_quiz->'description', quiz_language, minutes::integer, quiz_status, questions)
  on conflict (id) do update set
    title = excluded.title, description = excluded.description, language = excluded.language,
    duration_minutes = excluded.duration_minutes, status = excluded.status,
    questions = excluded.questions, updated_at = clock_timestamp();
  return quiz_id;
exception when invalid_text_representation then
  raise exception 'quiz_invalid_details' using errcode = '22023';
end;
$$;

create function public.quiz_admin_results(p_quiz_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform quiz_private.require_admin();
  if not exists (select 1 from quiz_private.quizzes where id = p_quiz_id) then
    raise exception 'quiz_not_found' using errcode = 'P0002';
  end if;
  perform quiz_private.expire_attempts(p_quiz_id, null);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'started_at', a.started_at, 'deadline_at', a.deadline_at,
      'submitted_at', a.submitted_at, 'elapsed_seconds', a.elapsed_seconds, 'reason', a.reason,
      'time_multiplier', a.time_multiplier, 'score', a.score, 'max_score', a.max_score,
      'manual_count', a.manual_count, 'answers', a.answers, 'quiz', quiz_private.without_keys(a.quiz)
    ) order by a.submitted_at desc, a.id desc), '[]'::jsonb)
    from quiz_private.attempts a where a.quiz_id = p_quiz_id and a.submitted_at is not null
  );
end;
$$;

revoke all on all functions in schema quiz_private from public, anon, authenticated;

revoke all on function public.quiz_list_live(), public.quiz_start(uuid, uuid, uuid, text, integer),
  public.quiz_attempt(uuid, uuid), public.quiz_save(uuid, uuid, jsonb, integer),
  public.quiz_submit(uuid, uuid, jsonb, integer), public.quiz_admin_list(),
  public.quiz_admin_get(uuid), public.quiz_admin_save(jsonb), public.quiz_admin_results(uuid)
  from public, anon, authenticated;

grant execute on function public.quiz_list_live(), public.quiz_start(uuid, uuid, uuid, text, integer),
  public.quiz_attempt(uuid, uuid), public.quiz_save(uuid, uuid, jsonb, integer),
  public.quiz_submit(uuid, uuid, jsonb, integer) to anon, authenticated;

grant execute on function public.quiz_admin_list(), public.quiz_admin_get(uuid),
  public.quiz_admin_save(jsonb), public.quiz_admin_results(uuid) to authenticated;

-- Finalize timed attempts even when a taker has closed the browser.
-- Admin reads also finalize due attempts, so reports need not wait for the job.
create extension if not exists pg_cron;
select cron.schedule(
  'vebebras-finalize-timed-attempts',
  '* * * * *',
  'select quiz_private.expire_attempts(null, 500);'
);

commit;
