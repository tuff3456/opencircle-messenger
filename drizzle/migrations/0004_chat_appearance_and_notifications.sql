ALTER TABLE public.conversations ADD COLUMN background_url text, ADD COLUMN members_edit_name boolean NOT NULL DEFAULT false, ADD COLUMN members_edit_cover boolean NOT NULL DEFAULT false, ADD COLUMN members_edit_background boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.protect_conversation_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.is_group IS DISTINCT FROM OLD.is_group OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Conversation identity cannot be changed'; END IF;
 IF public.has_role(auth.uid(), 'admin') OR (OLD.is_group AND OLD.created_by = auth.uid()) THEN RETURN NEW; END IF;
 IF NOT public.is_member(OLD.id, auth.uid()) THEN RAISE EXCEPTION 'Only chat members can edit appearance'; END IF;
 IF (to_jsonb(NEW) - ARRAY['name','avatar_url','background_url','last_message_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name','avatar_url','background_url','last_message_at']) THEN RAISE EXCEPTION 'Only the group creator can change permissions'; END IF;
 IF OLD.is_group THEN
  IF NEW.name IS DISTINCT FROM OLD.name AND NOT OLD.members_edit_name THEN RAISE EXCEPTION 'The creator has locked the chat name'; END IF;
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url AND NOT OLD.members_edit_cover THEN RAISE EXCEPTION 'The creator has locked the chat cover'; END IF;
  IF NEW.background_url IS DISTINCT FROM OLD.background_url AND NOT OLD.members_edit_background THEN RAISE EXCEPTION 'The creator has locked the chat background'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_conversation_settings BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.protect_conversation_settings();
DROP POLICY "conv update" ON public.conversations;
CREATE POLICY "conv update" ON public.conversations FOR UPDATE TO authenticated USING (created_by = auth.uid() OR public.is_member(id, auth.uid()) OR public.has_role(auth.uid(), 'admin')) WITH CHECK (created_by = auth.uid() OR public.is_member(id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('message','call','announcement')), title text NOT NULL, body text NOT NULL DEFAULT '', conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notification_update ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY notification_delete ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX notification_user_created ON public.notifications(user_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.deliver_chat_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_TABLE_NAME = 'messages' THEN
  INSERT INTO public.notifications(user_id, kind, title, body, conversation_id) SELECT m.user_id, 'message', 'New message', left(coalesce(nullif(NEW.content,''),'New attachment'),200), NEW.conversation_id FROM public.conversation_members m WHERE m.conversation_id = NEW.conversation_id AND m.user_id <> NEW.sender_id;
 ELSIF TG_TABLE_NAME = 'calls' THEN
  INSERT INTO public.notifications(user_id, kind, title, body, conversation_id) SELECT m.user_id, 'call', 'Incoming call', 'A call has started', NEW.conversation_id FROM public.conversation_members m WHERE m.conversation_id = NEW.conversation_id AND m.user_id <> NEW.started_by;
 ELSE
  INSERT INTO public.notifications(user_id, kind, title, body) SELECT p.id, 'announcement', 'Announcement', left(NEW.content,200) FROM public.profiles p WHERE p.id <> NEW.author_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER message_notification AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.deliver_chat_notification();
CREATE TRIGGER call_notification AFTER INSERT ON public.calls FOR EACH ROW EXECUTE FUNCTION public.deliver_chat_notification();
CREATE TRIGGER announcement_notification AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.deliver_chat_notification();
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;