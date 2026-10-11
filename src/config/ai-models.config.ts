/**
 * Every model this worker calls, in one place.
 *
 * Two different providers are in play: risk scoring runs on Anthropic Claude
 * through AWS Bedrock (it sees applicant PII and prior claims, so it stays
 * inside our AWS account), while decision-letter drafting runs on Google
 * Gemini with de-identified inputs. Keeping the ids here means a model
 * upgrade is a one-line change and an audit of what we run is a one-file read.
 */

export interface ModelConfig {
  /** Provider the call is made against. */
  readonly provider: 'aws-bedrock' | 'google-gemini';
  /**
   * Provider-specific model identifier.
   *
   * For Bedrock workloads this should be either:
   *   • A cross-region inference profile ID (e.g. `us.anthropic.claude-…`)
   *     for automatic regional failover and burst throughput, or
   *   • An application inference profile ARN for per-workload cost/metrics
   *     tracking in Cost Explorer and CloudWatch.
   *
   * The current value is the US cross-region inference profile. When the
   * underwriting workload is registered as an application inference profile
   * in the AWS console, replace this with that profile ARN so token usage and
   * spend can be attributed to this workload specifically (finding 5).
   */
  readonly modelId: string;
  /** Upper bound on generated tokens. */
  readonly maxOutputTokens: number;
  /** Sampling temperature. */
  readonly temperature: number;
  /**
   * Bedrock Guardrail identifier (required for aws-bedrock providers).
   * Populated from BEDROCK_GUARDRAIL_ID at runtime via WorkerConfig.
   * Left undefined for non-Bedrock providers.
   */
  readonly guardrailId?: string;
  /**
   * Bedrock Guardrail version string (e.g. "1").
   * Populated from BEDROCK_GUARDRAIL_VERSION at runtime via WorkerConfig.
   * Left undefined for non-Bedrock providers.
   */
  readonly guardrailVersion?: string;
}

export const AI_MODELS: Record<'riskScoring' | 'decisionLetter', ModelConfig> =
  {
    /**
     * Risk scoring agent — src/ai/risk-scoring.agent.ts
     * Handles applicant PII and prior claims history.
     *
     * Uses the US cross-region inference profile so Bedrock can spread load
     * across us-east-1, us-east-2, and us-west-2 and survive a regional
     * throttle or outage without stalling the underwriting queue.
     *
     * guardrailId / guardrailVersion are injected at runtime from env vars;
     * see WorkerConfig and .env.example.
     */
    riskScoring: {
      provider: 'aws-bedrock',
      modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      maxOutputTokens: 1024,
      // Underwriting has to be reproducible, so scoring is run greedily.
      temperature: 0,
    },

    /**
     * Decision letter drafting agent — src/ai/decision-letter.agent.ts
     * Receives the decision and the reasons, never the raw application.
     */
    decisionLetter: {
      provider: 'google-gemini',
      modelId: 'gemini-2.0-flash',
      maxOutputTokens: 900,
      // A little variation keeps letters from reading identically.
      temperature: 0.4,
    },
  };
