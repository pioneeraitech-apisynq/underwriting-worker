# Underwriting Worker

The background underwriting service of the Digital Insurance platform. It is
not an API: there is no HTTP server, no controllers and no `openapi.yaml`. The
process is a Kafka consumer built on a NestJS standalone application context,
and the only way work reaches it is a message on the applications topic.

When a customer submits an application through the Digital Insurance API, a
draft policy is created in the Policy API and an event is published to
`insurance.policy-applications.v1`. This worker picks that event up, scores the
risk, records a decision, and emails the applicant a decision letter.

## What one message does

1. Claim the application in Redis so a redelivered message is not scored twice.
2. Read the policy from the **Policy API** (`GET /v1/policies/{policyId}`), and
   its locally rated premium (`GET /v1/policies/{policyId}/quote-premium`).
3. Read the customer's prior loss history from the **Claims API**
   (`GET /v1/claims?policyNumber=...`).
4. Score the risk with the **risk scoring agent** on AWS Bedrock.
5. Turn the score into approve / refer / decline, and apply the risk multiplier
   to the base premium.
6. Push the outcome back to the Policy API
   (`POST /v1/policies/{policyId}/underwrite`, plus `.../cancel` on a decline).
7. Draft the customer's letter with the **decision letter agent** on Google
   Gemini and write the whole decision to Postgres.
8. Send the letter through SendGrid.

The decision is stored before the email goes out. A failed send is worth
retrying; a second underwriting run is not.

## What it depends on

| Dependency | Kind | Where it is used |
| ---------- | ---- | ---------------- |
| **Policy API** (internal) | HTTP, `POLICY_API_URL` | `src/clients/policy-api.client.ts` |
| **Claims API** (internal) | HTTP, `CLAIMS_API_URL` | `src/clients/claims-api.client.ts` |
| **Kafka** (`kafkajs`) | Message broker | `src/kafka/application-consumer.service.ts` |
| **Postgres** (`pg`) | Decision store | `src/db/decisions.repository.ts`, `src/db/schema.sql` |
| **Redis** (`ioredis`) | Cache and in-flight lock | `src/cache/cache.service.ts` |
| **SendGrid** (`@sendgrid/mail`) | Email delivery | `src/mail/mail.service.ts` |
| **AWS Bedrock** (`@aws-sdk/client-bedrock-runtime`) | Risk scoring model | `src/ai/risk-scoring.agent.ts` |
| **Google Gemini** (`@google/generative-ai`) | Letter drafting model | `src/ai/decision-letter.agent.ts` |

## The two agents

| Agent | Provider and model | Prompt | Sees |
| ----- | ------------------ | ------ | ---- |
| Risk scoring | AWS Bedrock, `anthropic.claude-3-5-sonnet-20241022-v2:0` | `src/ai/prompts/risk-scoring.prompt.ts` | Applicant identity and date of birth, property address and details, full prior-claims history |
| Decision letter | Google Gemini, `gemini-2.0-flash` | `src/ai/prompts/decision-letter.prompt.ts` | Decision, premium, first name, policy number, sanitised reasons |

Both model ids live in [`src/config/ai-models.config.ts`](./src/config/ai-models.config.ts)
so an upgrade is a one-line change and an audit of what the worker runs is a
one-file read.

Risk scoring runs on Bedrock rather than against a model provider directly
because its input carries applicant PII and claims history, and Bedrock keeps
that traffic inside our own AWS account. Its system prompt forbids the use of
protected characteristics, forbids age as a rating factor, and forbids
repeating the applicant's name, email, date of birth or street address in the
reasons it returns — which is why the letter agent can be given those reasons
without re-exposing personal data to a second provider.

The letter agent never sees the application. It is handed the decision, the
premium and the sanitised reasons, and it is told not to mention models,
scores or automation.

## Decisions

Decisions land in `underwriting_decisions` (see
[`src/db/schema.sql`](./src/db/schema.sql)), keyed on `application_id` and
upserted, so a redelivery overwrites rather than duplicates. Every row carries
the risk score, the reasons, the prior claim count, both model ids and the
letter that was sent.

Bands, in `src/underwriting/underwriting.service.ts`:

| Risk score | Outcome |
| ---------- | ------- |
| 0-39 | approved |
| 40-69 | referred to a human underwriter |
| 70-100 | declined |

An application is pulled up to a referral regardless of score when coverage
exceeds $1,000,000 or when the model's own confidence is below 0.6.

## Configuration

| Variable | Purpose |
| -------- | ------- |
| `KAFKA_BROKERS` | Comma-separated broker list |
| `KAFKA_CLIENT_ID` / `KAFKA_GROUP_ID` | Client and consumer group identity |
| `KAFKA_APPLICATIONS_TOPIC` | Topic of new policy applications |
| `KAFKA_SASL_USERNAME` / `KAFKA_SASL_PASSWORD` | SCRAM-SHA-512 credentials |
| `POSTGRES_URL` | Connection string for the decision store |
| `REDIS_URL` | Connection string for the cache |
| `POLICY_API_URL` | Base URL of the internal Policy API |
| `CLAIMS_API_URL` | Base URL of the internal Claims API |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Bedrock access |
| `GOOGLE_API_KEY` | Gemini access |
| `SENDGRID_API_KEY` | Email delivery |
| `DECISION_LETTER_FROM_EMAIL` / `DECISION_LETTER_REPLY_TO` | Letter addresses |

Required variables are checked at startup in `src/config/worker.config.ts`, so
a missing value fails the process immediately rather than surfacing as an
undefined host on the first message.

Copy `.env.example` to `.env` and fill it in. The committed `.env` holds demo
values only: every host in it is fictional and every secret is a placeholder.

## Run

```bash
npm install
npm run build
npm start
```

For a watch loop during development:

```bash
npm run start:dev
```

There is no port to open and no health endpoint to curl. The worker logs
`Underwriting worker started` followed by the topic it subscribed to; from
there, produce a message onto `insurance.policy-applications.v1` shaped like
`PolicyApplicationEvent` in `src/underwriting/application.types.ts`.
