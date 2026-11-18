
create type public.app_role as enum ('admin','user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_url text,
  banner_url text,
  bio text default '',
  status text default '',
  banned boolean not null default false,
  special_link text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create policy "roles read own or admin" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin manage roles ins" on public.user_roles for insert to authenticated
  with check (public.has_role(auth.uid(),'admin'));
create policy "admin manage roles del" on public.user_roles for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));
grant insert, delete on public.user_roles to authenticated;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "profiles update own or admin" on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then
    new.banned := old.banned;
    new.special_link := old.special_link;
    new.username := old.username;
  end if;
  return new;
end $$;
create trigger protect_profile before update on public.profiles
for each row execute function public.protect_profile_fields();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, username, display_name)
  values (new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1))),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  insert into public.user_roles(user_id, role) values (new.id,'user');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  is_private boolean not null default true,
  avatar_url text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, delete on public.conversation_members to authenticated;
grant all on public.conversations to service_role;
grant all on public.conversation_members to service_role;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;

create or replace function public.is_member(_conv uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.conversation_members where conversation_id=_conv and user_id=_user)
$$;

create policy "conv select" on public.conversations for select to authenticated
  using (public.is_member(id, auth.uid()) or public.has_role(auth.uid(),'admin') or (is_group and not is_private));
create policy "conv update" on public.conversations for update to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "conv delete" on public.conversations for delete to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'));

create policy "members select" on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin')
    or exists(select 1 from public.conversations c where c.id=conversation_id and c.is_group and not c.is_private));
create policy "members add" on public.conversation_members for insert to authenticated
  with check (
    public.has_role(auth.uid(),'admin')
    or exists(select 1 from public.conversations c where c.id=conversation_id and c.is_group and public.is_member(c.id, auth.uid()))
    or (user_id = auth.uid() and exists(select 1 from public.conversations c where c.id=conversation_id and c.is_group and not c.is_private))
  );
create policy "members remove" on public.conversation_members for delete to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin')
    or exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=auth.uid()));

-- messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text',
  content text default '',
  attachment_url text,
  attachment_name text,
  poll_options jsonb,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create index on public.messages(conversation_id, created_at);

create policy "msg select" on public.messages for select to authenticated
  using (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy "msg insert" on public.messages for insert to authenticated
  with check (sender_id = auth.uid()
    and (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin'))
    and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.banned));
create policy "msg update" on public.messages for update to authenticated
  using (sender_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "msg delete" on public.messages for delete to authenticated
  using (sender_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.bump_conv() returns trigger language plpgsql security definer set search_path=public as $$
begin update public.conversations set last_message_at = now() where id = new.conversation_id; return new; end $$;
create trigger bump_conv after insert on public.messages for each row execute function public.bump_conv();

create table public.poll_votes (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null,
  option_index int not null,
  primary key (message_id, user_id)
);
grant select, insert, update, delete on public.poll_votes to authenticated;
grant all on public.poll_votes to service_role;
alter table public.poll_votes enable row level security;
create policy "votes select" on public.poll_votes for select to authenticated
  using (exists(select 1 from public.messages m where m.id=message_id and (public.is_member(m.conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin'))));
create policy "votes ins" on public.poll_votes for insert to authenticated with check (user_id = auth.uid());
create policy "votes upd" on public.poll_votes for update to authenticated using (user_id = auth.uid());
create policy "votes del" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

-- calls
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  started_by uuid not null,
  video boolean not null default true,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.calls to authenticated;
grant all on public.calls to service_role;
alter table public.calls enable row level security;
create policy "calls select" on public.calls for select to authenticated
  using (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy "calls insert" on public.calls for insert to authenticated
  with check (started_by = auth.uid() and (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin')));
create policy "calls update" on public.calls for update to authenticated
  using (public.is_member(conversation_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

-- friends
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique(requester_id, addressee_id)
);
grant select, insert, update, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;
alter table public.friendships enable row level security;
create policy "fr select" on public.friendships for select to authenticated using (true);
create policy "fr insert" on public.friendships for insert to authenticated with check (requester_id = auth.uid());
create policy "fr update" on public.friendships for update to authenticated using (addressee_id = auth.uid());
create policy "fr delete" on public.friendships for delete to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());

-- reviews
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null default 5,
  content text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;
alter table public.reviews enable row level security;
create policy "rev select" on public.reviews for select to authenticated using (true);
create policy "rev insert" on public.reviews for insert to authenticated with check (author_id = auth.uid() and target_id <> auth.uid());
create policy "rev delete" on public.reviews for delete to authenticated using (author_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.review_delete_requests (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  requester_id uuid not null,
  reason text default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.review_delete_requests to authenticated;
grant all on public.review_delete_requests to service_role;
alter table public.review_delete_requests enable row level security;
create policy "rdr select" on public.review_delete_requests for select to authenticated using (requester_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "rdr insert" on public.review_delete_requests for insert to authenticated with check (requester_id = auth.uid());
create policy "rdr update" on public.review_delete_requests for update to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "rdr delete" on public.review_delete_requests for delete to authenticated using (public.has_role(auth.uid(),'admin'));

-- announcements
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null,
  content text not null,
  poll_options jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.announcements to authenticated;
grant all on public.announcements to service_role;
alter table public.announcements enable row level security;
create policy "ann select" on public.announcements for select to authenticated using (true);
create policy "ann insert" on public.announcements for insert to authenticated with check (public.has_role(auth.uid(),'admin') and author_id = auth.uid());
create policy "ann delete" on public.announcements for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.announcement_votes (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null,
  option_index int not null,
  primary key (announcement_id, user_id)
);
grant select, insert, update, delete on public.announcement_votes to authenticated;
grant all on public.announcement_votes to service_role;
alter table public.announcement_votes enable row level security;
create policy "av select" on public.announcement_votes for select to authenticated using (true);
create policy "av ins" on public.announcement_votes for insert to authenticated with check (user_id = auth.uid());
create policy "av upd" on public.announcement_votes for update to authenticated using (user_id = auth.uid());

-- RPCs
create or replace function public.get_or_create_dm(_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select c.id into cid from public.conversations c
   where not c.is_group
     and exists(select 1 from public.conversation_members where conversation_id=c.id and user_id=auth.uid())
     and exists(select 1 from public.conversation_members where conversation_id=c.id and user_id=_other)
   limit 1;
  if cid is not null then return cid; end if;
  insert into public.conversations(is_group, is_private, created_by) values (false, true, auth.uid()) returning id into cid;
  insert into public.conversation_members(conversation_id, user_id) values (cid, auth.uid()), (cid, _other)
    on conflict do nothing;
  return cid;
end $$;

create or replace function public.create_group(_name text, _private boolean, _members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; m uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.conversations(name, is_group, is_private, created_by) values (_name, true, _private, auth.uid()) returning id into cid;
  insert into public.conversation_members(conversation_id, user_id) values (cid, auth.uid());
  foreach m in array coalesce(_members, '{}') loop
    insert into public.conversation_members(conversation_id, user_id) values (cid, m) on conflict do nothing;
  end loop;
  return cid;
end $$;

create or replace function public.claim_admin(_code text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or _code <> '4001' then return false; end if;
  if public.has_role(auth.uid(),'admin') then return true; end if;
  if not exists(select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (auth.uid(),'admin');
    return true;
  end if;
  return false;
end $$;

create or replace function public.people_you_may_know()
returns table(id uuid, username text, display_name text, avatar_url text, mutuals int)
language sql stable security definer set search_path = public as $$
  with my_friends as (
    select case when requester_id=auth.uid() then addressee_id else requester_id end as fid
    from public.friendships where status='accepted' and (requester_id=auth.uid() or addressee_id=auth.uid())
  ), fof as (
    select case when f.requester_id=mf.fid then f.addressee_id else f.requester_id end as pid
    from public.friendships f join my_friends mf on (f.requester_id=mf.fid or f.addressee_id=mf.fid)
    where f.status='accepted'
  )
  select p.id, p.username, p.display_name, p.avatar_url,
    (select count(*) from fof where fof.pid=p.id)::int as mutuals
  from public.profiles p
  where p.id <> auth.uid() and p.id not in (select fid from my_friends) and not p.banned
    and not exists(select 1 from public.friendships x where (x.requester_id=auth.uid() and x.addressee_id=p.id) or (x.addressee_id=auth.uid() and x.requester_id=p.id))
  order by mutuals desc, p.created_at desc
  limit 12
$$;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_members;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.announcements;
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.poll_votes;
alter table public.messages replica identity full;
