import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  AI_MODELS,
  BEDROCK_ANTHROPIC_VERSION,
} from '../config/ai-models.config';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import {
  PolicyApplicationEvent,
  PolicyRecord,
  PriorClaim,
  RiskAssessment,
} from '../underwriting/application.types';
import {
  RISK_SCORING_SYSTEM_PROMPT,
  buildRiskScoringUserPrompt,
} from './prompts/risk-scoring.prompt';

/**
 * Risk scoring agent.
 *
 * Runs Anthropic Claude 3.5 Sonnet on AWS Bedrock. Bedrock is used rather
 * than the Anthropic API directly because the input carries applicant PII and
 * the customer's full claims history, and this keeps that traffic inside our
 * own AWS account.
 *
 * The agent returns a score and a recommendation; the decision itself is made
 * by UnderwritingService, which applies the bands and can override.
 */

interface BedrockAnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

@Injectable()
export class RiskScoringAgent {
  private readonly logger = new Logger(RiskScoringAgent.name);
  private readonly bedrock: BedrockRuntimeClient;
  private readonly model = AI_MODELS.riskScoring;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.bedrock = new BedrockRuntimeClient({ region: config.awsRegion });
  }

  /** The model id this agent runs, for the decision audit row. */
  get modelId(): string {
    return this.model.modelId;
  }

  async score(
    event: PolicyApplicationEvent,
    policy: PolicyRecord,
    priorClaims: PriorClaim[],
  ): Promise<RiskAssessment> {
    const userPrompt = buildRiskScoringUserPrompt({
      applicant: {
        customerId: event.applicant.customerId,
        fullName: event.applicant.fullName,
        dateOfBirth: event.applicant.dateOfBirth,
        yearsAtAddress: event.applicant.yearsAtAddress ?? null,
        creditBand: event.applicant.creditBand ?? null,
        priorInsurerLapseMonths:
          event.applicant.priorInsurerLapseMonths ?? null,
      },
      policy: {
        productType: policy.productType,
        coverageAmountCents: policy.coverageAmountCents,
        termMonths: policy.termMonths,
        basePremiumCents: policy.premiumCents,
      },
      property: event.property as unknown as Record<string, unknown>,
      priorClaims: priorClaims.map((claim) => ({
        status: claim.status,
        lossType: claim.lossType ?? null,
        amountCents: claim.amountCents ?? null,
        incidentDate: claim.incidentDate ?? null,
      })),
    });

    const command = new InvokeModelCommand({
      modelId: this.model.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: BEDROCK_ANTHROPIC_VERSION,
        max_tokens: this.model.maxOutputTokens,
        temperature: this.model.temperature,
        system: RISK_SCORING_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userPrompt }],
          },
        ],
      }),
    });

    const response = await this.bedrock.send(command);
    const payload = JSON.parse(
      Buffer.from(response.body).toString('utf-8'),
    ) as BedrockAnthropicResponse;

    if (payload.stop_reason === 'max_tokens') {
      this.logger.warn(
        `Risk scoring hit the token ceiling for application ${event.applicationId}`,
      );
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();

    return this.parseAssessment(text, event.applicationId);
  }

  /**
   * The prompt asks for bare JSON, but a model can still wrap it in a fence or
   * add a sentence, so the object is extracted and every field is clamped to
   * its documented range before it is trusted.
   */
  private parseAssessment(text: string, applicationId: string): RiskAssessment {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error(
        `Risk scoring returned no JSON object for application ${applicationId}`,
      );
    }

    let parsed: Partial<RiskAssessment>;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (error) {
      throw new Error(
        `Risk scoring returned malformed JSON for application ${applicationId}: ${
          (error as Error).message
        }`,
      );
    }

    const riskScore = clamp(Math.round(Number(parsed.riskScore)), 0, 100);
    const recommendation =
      parsed.recommendation === 'approve' ||
      parsed.recommendation === 'refer' ||
      parsed.recommendation === 'decline'
        ? parsed.recommendation
        : recommendationFor(riskScore);

    if (!Number.isFinite(riskScore)) {
      throw new Error(
        `Risk scoring returned a non-numeric score for application ${applicationId}`,
      );
    }

    return {
      riskScore,
      recommendation,
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.map(String).slice(0, 5)
        : [],
      premiumMultiplier:
        recommendation === 'decline'
          ? 1
          : clamp(Number(parsed.premiumMultiplier) || 1, 0.85, 1.75),
      confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/** Fallback banding, used when the model omits a usable recommendation. */
function recommendationFor(riskScore: number): RiskAssessment['recommendation'] {
  if (riskScore >= 70) {
    return 'decline';
  }
  if (riskScore >= 40) {
    return 'refer';
  }
  return 'approve';
}
