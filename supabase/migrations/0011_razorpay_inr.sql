-- P?? — Razorpay + INR switch.
-- The academy moved from Stripe (GBP) to Razorpay (INR). Column names ending
-- in "_pence" now hold the minor unit of INR (paise); values are ×100 the old
-- rupee-numeral pricing the founder set. New razorpay_* columns mirror what the
-- stripe_* columns did. Existing Stripe columns are kept (nullable) so old rows
-- and history don't break — new writes just stop populating them.

-- 1. Currency + price bump. Old price_pence held a GBP-numeral (e.g. 18000 =
--    £180); the founder wants the same numerals as rupees (₹18,000), so paise
--    = old_value × 100.
update public.plans set currency = 'inr';
update public.plans set price_pence = price_pence * 100
  where price_pence < 1000000;   -- guard: only bump rows still in the old scale

alter table public.plans alter column currency set default 'inr';
alter table public.invoices alter column currency set default 'inr';

-- 2. Razorpay identifiers alongside the Stripe ones.
alter table public.plans          add column if not exists razorpay_plan_id text unique;
alter table public.profiles       add column if not exists razorpay_customer_id text unique;
alter table public.subscriptions  add column if not exists razorpay_subscription_id text unique;
alter table public.invoices       add column if not exists razorpay_payment_id text;

-- Stripe subscriptions required a stripe_subscription_id; Razorpay ones won't
-- have one. Drop that constraint so source='razorpay' rows can insert.
alter table public.subscriptions drop constraint if exists stripe_subs_have_id;

-- 3. New subscription source. Postgres enum values can't be added inside a
--    txn that also uses them, but a plain migration file is fine.
alter type public.subscription_source add value if not exists 'razorpay';

-- 4. Razorpay webhooks are keyed by event id (x-razorpay-event-id header).
--    Reuse webhook_events but relax the Stripe-specific column.
alter table public.webhook_events alter column stripe_event_id drop not null;
alter table public.webhook_events add column if not exists event_id text unique;

-- invoices.stripe_invoice_id was NOT NULL; Razorpay invoices key differently.
alter table public.invoices alter column stripe_invoice_id drop not null;
