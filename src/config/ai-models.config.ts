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
  /** Provider-specific model identifier. */
  readonly modelId: string;
  /** Upper bound on generated tokens. */
  readonly maxOutputTokens: number;
  /** Sampling temperature. */
  readonly temperature: number;
}

export const AI_MODELS: Record<'riskScoring' | 'decisionLetter', ModelConfig> =
  {
    /**
     * Risk scoring agent — src/ai/risk-scoring.agent.ts
     * Handles applicant PII and prior claims history.
     *
     * Uses the US cross-region system inference profile so that Bedrock can
     * automatically route requests across us-east-1, us-west-2, and other
     * supported US regions, avoiding quota-exhaustion failures during peak
     * underwriting load. The "us." prefix is what distinguishes a cross-region
     * inference profile from a single-region foundation model ARN.
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

/** Bedrock's wire version for the Anthropic Messages API. */
export const BEDROCK_ANTHROPIC_VERSION = 'bedrock-2023-05-31';
