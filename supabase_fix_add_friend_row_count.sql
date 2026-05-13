-- Fix : RPC add_friend plantait silencieusement quand une vraie demande
-- d'ami était créée (cas row_count = 2). PostgreSQL refusait le cast
-- automatique integer → boolean lors du GET DIAGNOSTICS, throw avec :
--   ERROR 22P02 invalid input syntax for type boolean: "2"
--   CONTEXT  PL/pgSQL function add_friend(uuid) line 16 at GET DIAGNOSTICS
--
-- Conséquence côté UI : le bouton "+ Ajouter" dans la section AMIS du Club
-- semblait inerte. L'optimistic update mettait "Demande envoyée" puis
-- l'erreur du RPC le rollbackait sans message — silence total côté front.
--
-- Migration appliquée sur Supabase prod le 2026-05-13.

create or replace function public.add_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count integer := 0;
begin
  insert into friendships (user_id, friend_id, status)
  values
    (auth.uid(),    p_friend_id, 'pending'),
    (p_friend_id,   auth.uid(),  'incoming')
  on conflict (user_id, friend_id) do nothing;

  get diagnostics v_row_count = row_count;

  if v_row_count > 0 then
    insert into notifications (user_id, type, from_user_id, read)
    values (p_friend_id, 'friend_request', auth.uid(), false);
  end if;
end;
$$;
