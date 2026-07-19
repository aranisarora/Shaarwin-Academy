-- Replace 90-minute private plans with 3×/week and 4×/week 60-minute plans.
-- No active subscribers existed on the 90-minute plans at migration time.

-- Deactivate 90-minute private plans
UPDATE plans SET active = false
WHERE id IN (
  '00000000-0000-4000-8000-0000000000d8',  -- Private — Weekly, 90 min
  '00000000-0000-4000-8000-0000000000da'   -- Private — 2×/week, 90 min
);

-- Add 3×/week 60 min at ₹12,000/month
-- private_minutes_per_cycle: 3 × 60 min × 4.33 weeks ≈ 780 min
INSERT INTO plans (id, name, description, price_pence, currency, billing_interval_months, group_sessions_per_week, private_minutes_per_cycle, private_sessions_per_week, private_session_minutes)
VALUES (
  '00000000-0000-4000-8000-0000000000db',
  'Private — 3×/week, 60 min',
  'Three 60-minute home sessions a week (780 minutes a month).',
  1200000, 'inr', 1, 0, 780, 3, 60
);

-- Add 4×/week 60 min at ₹16,000/month
-- private_minutes_per_cycle: 4 × 60 min × 4.33 weeks ≈ 1040 min
INSERT INTO plans (id, name, description, price_pence, currency, billing_interval_months, group_sessions_per_week, private_minutes_per_cycle, private_sessions_per_week, private_session_minutes)
VALUES (
  '00000000-0000-4000-8000-0000000000dc',
  'Private — 4×/week, 60 min',
  'Four 60-minute home sessions a week (1040 minutes a month).',
  1600000, 'inr', 1, 0, 1040, 4, 60
);
