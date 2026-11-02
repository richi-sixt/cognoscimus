-- E-mail notifications for borrow requests and their answers. On by default for a
-- profile, off when the owner switches it off. The server sends the mail only if
-- an SMTP account is configured. Run once, after 0022.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true;
