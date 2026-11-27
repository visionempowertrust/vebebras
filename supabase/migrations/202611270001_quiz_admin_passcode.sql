begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table quiz_private.admin_passcode (
  singleton boolean primary key default true check (singleton),
  verifier text not null,
  window_started_at timestamptz,
  failed_attempts integer not null default 0,
  blocked_until timestamptz
);

create table quiz_private.admin_sessions (
  token_hash bytea primary key,
  expires_at timestamptz not null
);

alter table quiz_private.admin_passcode enable row level security;
alter table quiz_private.admin_sessions enable row level security;
revoke all on quiz_private.admin_passcode, quiz_private.admin_sessions
  from public, anon, authenticated, service_role;

create function quiz_private.set_admin_passcode(p_passcode text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_passcode is null or length(p_passcode) < 4 or octet_length(p_passcode) > 72 then
    raise exception 'Use at least four characters and no more than 72 UTF-8 bytes.'
      using errcode = '22023';
  end if;

  insert into quiz_private.admin_passcode (singleton, verifier)
  values (true, extensions.crypt(p_passcode, extensions.gen_salt('bf', 10)))
  on conflict (singleton) do update
    set verifier = excluded.verifier, window_started_at = null,
        failed_attempts = 0, blocked_until = null;

  delete from quiz_private.admin_sessions;
end;
$$;

revoke all on function quiz_private.set_admin_passcode(text) from public, anon, authenticated, service_role;

create function public.quiz_admin_login(p_passcode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  settings quiz_private.admin_passcode;
  observed_at timestamptz;
  login_token uuid;
  login_expires_at timestamptz;
  login_valid boolean := false;
  failure_limit constant integer := 12;
  failure_window constant interval := interval '5 minutes';
begin
  select * into settings from quiz_private.admin_passcode where singleton for update;
  if not found then
    perform set_config('response.status', '503', true);
    return jsonb_build_object(
      'code', 'quiz_admin_passcode_unset', 'message', 'The administrator passcode has not been configured.'
    );
  end if;

  observed_at := clock_timestamp();
  if settings.blocked_until > observed_at then
    perform set_config('response.status', '429', true);
    return jsonb_build_object(
      'code', 'quiz_admin_rate_limited', 'message', 'Too many attempts. Try again in a few minutes.'
    );
  end if;

  if p_passcode is not null and octet_length(p_passcode) between 4 and 72 then
    login_valid := extensions.crypt(p_passcode, settings.verifier) = settings.verifier;
  end if;

  if not login_valid then
    if settings.window_started_at is null or settings.window_started_at + failure_window <= observed_at then
      settings.window_started_at := observed_at;
      settings.failed_attempts := 0;
    end if;

    settings.failed_attempts := settings.failed_attempts + 1;
    if settings.failed_attempts >= failure_limit then
      update quiz_private.admin_passcode
      set window_started_at = null, failed_attempts = 0, blocked_until = observed_at + failure_window
      where singleton;
      perform set_config('response.status', '429', true);
      return jsonb_build_object(
        'code', 'quiz_admin_rate_limited', 'message', 'Too many attempts. Try again in a few minutes.'
      );
    end if;

    update quiz_private.admin_passcode
    set window_started_at = settings.window_started_at, failed_attempts = settings.failed_attempts,
        blocked_until = null
    where singleton;
    perform set_config('response.status', '400', true);
    return jsonb_build_object('code', 'invalid_credentials', 'message', 'The passcode is incorrect.');
  end if;

  update quiz_private.admin_passcode
  set window_started_at = null, failed_attempts = 0, blocked_until = null
  where singleton;

  login_token := gen_random_uuid();
  login_expires_at := clock_timestamp() + interval '8 hours';
  delete from quiz_private.admin_sessions where expires_at <= observed_at;
  insert into quiz_private.admin_sessions (token_hash, expires_at)
  values (sha256(convert_to(login_token::text, 'UTF8')), login_expires_at);

  return jsonb_build_object('token', login_token, 'expires_at', login_expires_at);
end;
$$;

create function public.quiz_admin_logout(p_session_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from quiz_private.admin_sessions
  where token_hash = sha256(convert_to(p_session_token::text, 'UTF8'));
$$;

-- Retain the existing implementation and access its routines only through the
-- token-taking API below. The previous Supabase Auth allowlist is no longer read.
alter function public.quiz_admin_list() set schema quiz_private;
alter function public.quiz_admin_get(uuid) set schema quiz_private;
alter function public.quiz_admin_save(jsonb) set schema quiz_private;
alter function public.quiz_admin_results(uuid) set schema quiz_private;

revoke all on function quiz_private.quiz_admin_list(), quiz_private.quiz_admin_get(uuid),
  quiz_private.quiz_admin_save(jsonb), quiz_private.quiz_admin_results(uuid)
  from public, anon, authenticated, service_role;

create or replace function quiz_private.require_admin()
returns void language plpgsql set search_path = '' as $$
declare
  session_token text := nullif(current_setting('quiz.admin_session_token', true), '');
begin
  if not exists (
    select 1 from quiz_private.admin_sessions
    where token_hash = sha256(convert_to(session_token, 'UTF8'))
      and expires_at > clock_timestamp()
  ) then
    raise exception 'quiz_sign_in' using errcode = 'PT401';
  end if;
end;
$$;

create function public.quiz_admin_list(p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('quiz.admin_session_token', coalesce(p_session_token::text, ''), true);
  return quiz_private.quiz_admin_list();
end;
$$;

create function public.quiz_admin_get(p_quiz_id uuid, p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('quiz.admin_session_token', coalesce(p_session_token::text, ''), true);
  return quiz_private.quiz_admin_get(p_quiz_id);
end;
$$;

create function public.quiz_admin_save(p_quiz jsonb, p_session_token uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('quiz.admin_session_token', coalesce(p_session_token::text, ''), true);
  return quiz_private.quiz_admin_save(p_quiz);
end;
$$;

create function public.quiz_admin_results(p_quiz_id uuid, p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('quiz.admin_session_token', coalesce(p_session_token::text, ''), true);
  return quiz_private.quiz_admin_results(p_quiz_id);
end;
$$;

revoke all on function public.quiz_admin_login(text), public.quiz_admin_logout(uuid),
  public.quiz_admin_list(uuid), public.quiz_admin_get(uuid, uuid),
  public.quiz_admin_save(jsonb, uuid), public.quiz_admin_results(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.quiz_admin_login(text), public.quiz_admin_logout(uuid),
  public.quiz_admin_list(uuid), public.quiz_admin_get(uuid, uuid),
  public.quiz_admin_save(jsonb, uuid), public.quiz_admin_results(uuid, uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
