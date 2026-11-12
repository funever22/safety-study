create schema if not exists safety_private;
revoke all on schema safety_private from public, anon, authenticated;
grant usage on schema safety_private to service_role;

create table safety_private.learner (
 id boolean primary key default true check(id),
 code_hash text not null,
 revision bigint not null default 0,
 state jsonb not null default '{"schema":1,"attempts":[],"sessions":[],"active":null}'::jsonb,
 updated_at timestamptz not null default now()
);
create table safety_private.sessions (
 token_hash text primary key, expires_at timestamptz not null
);
create table safety_private.login_limits (
 bucket text primary key, hits integer not null, reset_at timestamptz not null
);
alter table safety_private.learner enable row level security;
alter table safety_private.sessions enable row level security;
alter table safety_private.login_limits enable row level security;
grant select,insert,update,delete on all tables in schema safety_private to service_role;

-- Only the edge service can execute this function; browser roles have no table or RPC access.
create function public.safety_study_rpc(p_action text, p_args jsonb)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, safety_private, extensions
as $$
declare l safety_private.learner%rowtype; token text; th text; ip text;
        bucket_key text; hit_count integer; limit_n integer; proposed jsonb;
begin
 select * into l from safety_private.learner where id=true for update;
 if not found then return jsonb_build_object('error','not_ready'); end if;
 if p_action='login' then
  ip:=left(coalesce(p_args->>'ip','unknown'),80);
  foreach bucket_key in array array['ip:'||ip,'global'] loop
   limit_n:=case when bucket_key='global' then 60 else 8 end;
   insert into safety_private.login_limits(bucket,hits,reset_at)
    values(bucket_key,1,now()+interval '10 minutes')
   on conflict(bucket) do update set
    hits=case when login_limits.reset_at<now() then 1 else login_limits.hits+1 end,
    reset_at=case when login_limits.reset_at<now() then now()+interval '10 minutes' else login_limits.reset_at end
   returning hits into hit_count;
   if hit_count>limit_n then return jsonb_build_object('error','too_many_requests');end if;
  end loop;
  if coalesce(p_args->>'code','') !~ '^\d{6}$' or extensions.crypt(p_args->>'code',l.code_hash)<>l.code_hash then
   return jsonb_build_object('error','invalid_code');
  end if;
  token:=encode(extensions.gen_random_bytes(32),'hex');
  th:=encode(extensions.digest(token,'sha256'),'hex');
  delete from safety_private.sessions where expires_at<now();
  insert into safety_private.sessions values(th,now()+interval '30 days');
  return jsonb_build_object('token',token,'state',l.state,'revision',l.revision);
 end if;
 th:=encode(extensions.digest(coalesce(p_args->>'token',''),'sha256'),'hex');
 if not exists(select 1 from safety_private.sessions where token_hash=th and expires_at>now()) then
  return jsonb_build_object('error','unauthorized');
 end if;
 if p_action='logout' then
  delete from safety_private.sessions where token_hash=th;
  return jsonb_build_object('ok',true);
 elsif p_action='read' then
  return jsonb_build_object('state',l.state,'revision',l.revision);
 elsif p_action='write' then
  if (p_args->>'revision')::bigint<>l.revision then
   return jsonb_build_object('conflict',true,'state',l.state,'revision',l.revision);
  end if;
  proposed:=p_args->'state';
  if proposed is null or jsonb_typeof(proposed)<>'object'
    or proposed->>'schema'<>'1' or jsonb_typeof(proposed->'attempts')<>'array'
    or jsonb_typeof(proposed->'sessions')<>'array' or octet_length(proposed::text)>5000000 then
   return jsonb_build_object('error','invalid_state');
  end if;
  -- Never accept a snapshot which silently deletes already stored attempt or session IDs.
  if exists(select 1 from jsonb_array_elements(l.state->'attempts') old
   where not exists(select 1 from jsonb_array_elements(proposed->'attempts') n where n->>'id'=old->>'id'))
   or exists(select 1 from jsonb_array_elements(l.state->'sessions') old
   where not exists(select 1 from jsonb_array_elements(proposed->'sessions') n where n->>'id'=old->>'id')) then
   return jsonb_build_object('conflict',true,'state',l.state,'revision',l.revision);
  end if;
  update safety_private.learner set state=proposed,revision=revision+1,updated_at=now() where id=true
   returning * into l;
  return jsonb_build_object('state',l.state,'revision',l.revision);
 end if;
 return jsonb_build_object('error','invalid_action');
end;
$$;
revoke all on function public.safety_study_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.safety_study_rpc(text,jsonb) to service_role;
