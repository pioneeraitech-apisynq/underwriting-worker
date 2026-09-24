/**
 * Environment-backed settings for the worker.
 *
 * Every value is read once at startup and the required ones are checked, so a
 * missing variable fails the process immediately instead of surfacing as an
 * undefined host halfway through the first message.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  groupId: string;
  applicationsTopic: string;
  saslUsername: string;
  saslPassword: string;
}

export interface WorkerConfig {
  kafka: KafkaConfig;
  postgresUrl: string;
  redisUrl: string;
  policyApiUrl: string;
  claimsApiUrl: string;
  awsRegion: string;
  googleApiKey: string;
  sendgridApiKey: string;
  /**
   * Must be a sender address (or domain) that has been verified inside the
   * SendGrid account. SendGrid rejects sends from unverified senders with a
   * 403 error. Set DECISION_LETTER_FROM_EMAIL in every environment.
   * See: https://docs.sendgrid.com/ui/sending-email/sender-verification
   */
  decisionLetterFromEmail: string;
  decisionLetterReplyTo: string;
  /**
   * SendGrid Dynamic Template ID for decision letters (starts with "d-…").
   * The template must expose the Handlebars variables consumed by
   * MailService#sendDecisionLetter: applicantName, policyNumber, decision,
   * body.
   * Set DECISION_LETTER_TEMPLATE_ID in every environment.
   */
  decisionLetterTemplateId: string;
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    kafka: {
      brokers: required('KAFKA_BROKERS')
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean),
      clientId: optional('KAFKA_CLIENT_ID', 'underwriting-worker'),
      groupId: optional('KAFKA_GROUP_ID', 'underwriting-worker'),
      applicationsTopic: optional(
        'KAFKA_APPLICATIONS_TOPIC',
        'insurance.policy-applications.v1',
      ),
      saslUsername: required('KAFKA_SASL_USERNAME'),
      saslPassword: required('KAFKA_SASL_PASSWORD'),
    },
    postgresUrl: required('POSTGRES_URL'),
    redisUrl: required('REDIS_URL'),
    policyApiUrl: required('POLICY_API_URL'),
    claimsApiUrl: required('CLAIMS_API_URL'),
    awsRegion: optional('AWS_REGION', 'us-east-1'),
    googleApiKey: required('GOOGLE_API_KEY'),
    sendgridApiKey: required('SENDGRID_API_KEY'),
    // Required — SendGrid rejects sends from unverified senders (403).
    decisionLetterFromEmail: required('DECISION_LETTER_FROM_EMAIL'),
    decisionLetterReplyTo: optional(
      'DECISION_LETTER_REPLY_TO',
      'support@digitalinsurance.dev',
    ),
    // Required — the Dynamic Template that renders decision letters.
    decisionLetterTemplateId: required('DECISION_LETTER_TEMPLATE_ID'),
  };
}

/** Injection token for the loaded config. */
export const WORKER_CONFIG = 'WORKER_CONFIG';
