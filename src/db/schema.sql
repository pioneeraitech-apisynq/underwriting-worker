-- Underwriting decisions written by this worker. Applied at startup by
-- DecisionsRepository.ensureSchema().

CREATE TABLE IF NOT EXISTS underwriting_decisions (
  application_id     TEXT PRIMARY KEY,
  policy_id          TEXT NOT NULL,
  policy_number      TEXT NOT NULL,
  customer_id        TEXT NOT NULL,
  decision           TEXT NOT NULL CHECK (decision IN ('approved', 'referred', 'declined')),
  risk_score         INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  premium_cents      BIGINT NOT NULL DEFAULT 0,
  reasons            JSONB NOT NULL DEFAULT '[]'::jsonb,
  prior_claim_count  INTEGER NOT NULL DEFAULT 0,
  model_id           TEXT NOT NULL,
  letter_model_id    TEXT NOT NULL,
  letter_body        TEXT NOT NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS underwriting_decisions_policy_number_idx
  ON underwriting_decisions (policy_number);

CREATE INDEX IF NOT EXISTS underwriting_decisions_customer_id_idx
  ON underwriting_decisions (customer_id);

CREATE INDEX IF NOT EXISTS underwriting_decisions_decided_at_idx
  ON underwriting_decisions (decided_at DESC);
