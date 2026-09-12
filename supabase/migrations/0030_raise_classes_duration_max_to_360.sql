-- Raise the max allowed class duration from 240 to 360 minutes so long
-- school drop-in group blocks (e.g. Asphire 340m, TCIS Varthur 285/330m) fit.
ALTER TABLE public.classes DROP CONSTRAINT classes_duration_minutes_check;
ALTER TABLE public.classes ADD CONSTRAINT classes_duration_minutes_check
  CHECK (((duration_minutes >= 30) AND (duration_minutes <= 360)));
