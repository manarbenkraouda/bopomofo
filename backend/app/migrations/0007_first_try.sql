-- Keep the raw recordings and units. Progress reads one first-try result per card.
-- The marker limits the new rule to new answers; old history keeps its recorded meaning.
CREATE VIEW practice_events WITH (security_invoker = true) AS
SELECT id, user_id, ts, day, area, mode, item, ok, first_try, score, ms, tries, help, replays, legacy, details
FROM (
  SELECT e.*, ROW_NUMBER() OVER (
    PARTITION BY user_id, area, mode, item,
      CASE WHEN details::jsonb ->> 'first_try_limit' = '3'
        THEN COALESCE(details::jsonb ->> 'attempt_card', 'event:' || id::text)
        ELSE 'event:' || id::text END
    ORDER BY
      CASE WHEN details::jsonb ->> 'first_try_limit' = '3' AND COALESCE(tries, 1) <= 3 THEN 0 ELSE 1 END,
      first_try DESC NULLS LAST, score DESC NULLS LAST, help, ts DESC, id DESC
  ) AS result_n
  FROM events e
) ranked
WHERE result_n = 1;

CREATE VIEW practice_units WITH (security_invoker = true) AS
SELECT id, user_id, event_id, ts, day, area, mode, kind, expected, actual, ok, pos,
  CASE WHEN credit_rule THEN
    CASE WHEN id = credit_id AND try_n < 3 THEN 0 ELSE try_n + 1 END
    ELSE try_n END AS try_n,
  help, ctx, lex, prev, next, source, uncertain, extra
FROM (
  SELECT u.*, e.details::jsonb ->> 'first_try_limit' = '3'
    AND COALESCE(e.details::jsonb ->> 'learn', 'false') IN ('false', '0', '') AS credit_rule,
    FIRST_VALUE(u.id) OVER (
      PARTITION BY u.user_id, u.area, u.mode, e.item, u.kind, u.expected, u.pos,
        CASE WHEN e.details::jsonb ->> 'first_try_limit' = '3'
          THEN COALESCE(e.details::jsonb ->> 'attempt_card', 'event:' || e.id::text)
          ELSE 'event:' || e.id::text END
      ORDER BY CASE WHEN u.try_n < 3 AND u.ok = 1 AND u.help = 0 THEN 0 ELSE 1 END, u.try_n, u.id
    ) AS credit_id
  FROM units u JOIN events e ON e.id = u.event_id
) ranked;
