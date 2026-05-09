-- Refacto friendships : système pending / accept / decline
-- (V1 = auto-accept, V2 = demande qui doit être acceptée)
--
-- Statuts utilisés :
--   pending   = demande envoyée par moi (côté demandeur)
--   incoming  = demande reçue par moi   (côté destinataire)
--   accepted  = amitié confirmée des 2 côtés

drop function if exists public.add_friend(uuid);
create function public.add_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  insert into friendships (user_id, friend_id, status)
  values
    (auth.uid(),    p_friend_id, 'pending'),
    (p_friend_id,   auth.uid(),  'incoming')
  on conflict (user_id, friend_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    insert into notifications (user_id, type, from_user_id, read)
    values (p_friend_id, 'friend_request', auth.uid(), false);
  end if;
end;
$$;

create or replace function public.accept_friend(p_requester_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update friendships set status = 'accepted'
  where ((user_id = auth.uid()    and friend_id = p_requester_id and status = 'incoming')
      or (user_id = p_requester_id and friend_id = auth.uid()    and status = 'pending'));

  if not found then return; end if;

  insert into notifications (user_id, type, from_user_id, read)
  values (p_requester_id, 'friend_added', auth.uid(), false);
end;
$$;

create or replace function public.decline_friend(p_other_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friendships
  where ((user_id = auth.uid() and friend_id = p_other_id)
      or (user_id = p_other_id and friend_id = auth.uid()))
    and status in ('pending','incoming');
end;
$$;
