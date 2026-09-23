import { Injectable, Logger } from '@nestjs/common';
import { RiskScoringAgent } from '../ai/risk-scoring.agent';
import { DecisionLetterAgent } from '../ai/decision-letter.agent';
import { CacheService } from '../cache/cache.service';
import { DecisionsRepository } from '../db/decisions.repository';
import { MailService } from '../mail/mail.service';
import * as policyApi from '../clients/policy-api.client';
import * as claimsApi from '../clients/claims-api.client';
import {
  PolicyApplicationEvent,
  PolicyRecord,
  PriorClaim,
  RiskAssessment,
  UnderwritingDecision,
} from './application.types';

/**
 * The whole underwriting run for one application:
 *
 *   1. claim the application so a redelivery is not scored twice
 *   2. read the policy from the Policy API (cached)
 *   3. read prior claims from the Claims API (cached)
 *   4. score the risk on Bedrock
 *   5. turn the score into a decision and a premium
 *   6. push the decision back to the Policy API
 *   7. draft the letter on Gemini and store the decision in Postgres
 *   8. send the letter through SendGrid
 *
 * The decision is stored before the letter is sent: a failed email is worth
 * retrying, a second underwriting run is not.
 */
@Injectable()
export class UnderwritingService {
  private readonly logger = new Logger(UnderwritingService.name);

  /** Anything at or above this score goes to a human regardless of exposure. */
  private static readonly REFER_THRESHOLD = 40;
  private static readonly DECLINE_THRESHOLD = 70;
  /** Coverage above this always gets a second pair of eyes. */
  private static readonly LARGE_EXPOSURE_CENTS = 100_000_000;
  /** Below this the model is not trusted to approve on its own. */
  private static readonly MIN_AUTO_DECISION_CONFIDENCE = 0.6;

  constructor(
    private readonly riskScoring: RiskScoringAgent,
    private readonly decisionLetter: DecisionLetterAgent,
    private readonly cache: CacheService,
    private readonly decisions: DecisionsRepository,
    private readonly mail: MailService,
  ) {}

  async handleApplication(event: PolicyApplicationEvent): Promise<void> {
    if (await this.decisions.hasDecision(event.applicationId)) {
      this.logger.log(
        `Application ${event.applicationId} already has a decision, skipping`,
      );
      return;
    }

    const claimed = await this.cache.acquireApplicationLock(
      event.applicationId,
    );
    if (!claimed) {
      this.logger.log(
        `Application ${event.applicationId} is being handled elsewhere, skipping`,
      );
      return;
    }

    try {
      const policy = await this.loadPolicy(event.policyId);
      const priorClaims = await this.loadPriorClaims(event.policyNumber);

      const assessment = await this.riskScoring.score(
        event,
        policy,
        priorClaims,
      );

      const decision = this.decide(assessment, policy);
      const premiumCents = this.premiumFor(decision, assessment, policy);

      await this.recordWithPolicyApi(event, decision, assessment, premiumCents);

      const letterBody = await this.decisionLetter.draft({
        firstName: firstNameOf(event.applicant.fullName),
        policyNumber: event.policyNumber,
        productType: policy.productType,
        decision,
        reasons: assessment.reasons,
        premiumCents,
        termMonths: policy.termMonths,
        currency: 'USD',
      });

      const record: UnderwritingDecision = {
        applicationId: event.applicationId,
        policyId: event.policyId,
        policyNumber: event.policyNumber,
        customerId: event.applicant.customerId,
        decision,
        riskScore: assessment.riskScore,
        premiumCents,
        reasons: assessment.reasons,
        priorClaimCount: priorClaims.length,
        modelId: this.riskScoring.modelId,
        letterModelId: this.decisionLetter.modelId,
        letterBody,
        decidedAt: new Date().toISOString(),
      };

      await this.decisions.save(record);

      await this.mail.sendDecisionLetter({
        to: event.applicant.email,
        applicantName: event.applicant.fullName,
        policyNumber: event.policyNumber,
        decision,
        body: letterBody,
      });

      this.logger.log(
        `Application ${event.applicationId} ${decision} at risk score ${assessment.riskScore} (${priorClaims.length} prior claims)`,
      );
    } finally {
      await this.cache.releaseApplicationLock(event.applicationId);
    }
  }

  /** Policy API read, served from Redis when it is warm. */
  private async loadPolicy(policyId: string): Promise<PolicyRecord> {
    const cached = await this.cache.getPolicy(policyId);
    if (cached) {
      return cached;
    }
    const policy = await policyApi.getPolicy(policyId);
    await this.cache.putPolicy(policy);
    return policy;
  }

  /** Claims API read, served from Redis when it is warm. */
  private async loadPriorClaims(policyNumber: string): Promise<PriorClaim[]> {
    const cached = await this.cache.getPriorClaims(policyNumber);
    if (cached) {
      return cached;
    }
    const claims = await claimsApi.listClaimsByPolicyNumber(policyNumber);
    await this.cache.putPriorClaims(policyNumber, claims);
    return claims;
  }

  /**
   * The model recommends; the bands here decide. Large exposures and
   * low-confidence scores are pulled up to a referral so a human sees them.
   */
  private decide(
    assessment: RiskAssessment,
    policy: PolicyRecord,
  ): UnderwritingDecision['decision'] {
    if (
      assessment.riskScore >= UnderwritingService.DECLINE_THRESHOLD ||
      assessment.recommendation === 'decline'
    ) {
      return 'declined';
    }

    if (
      assessment.riskScore >= UnderwritingService.REFER_THRESHOLD ||
      assessment.recommendation === 'refer' ||
      assessment.confidence < UnderwritingService.MIN_AUTO_DECISION_CONFIDENCE ||
      policy.coverageAmountCents > UnderwritingService.LARGE_EXPOSURE_CENTS
    ) {
      return 'referred';
    }

    return 'approved';
  }

  /**
   * The Policy API's locally rated premium is the base; the risk multiplier
   * is applied on top of it. A declined or referred application carries no
   * premium yet.
   */
  private premiumFor(
    decision: UnderwritingDecision['decision'],
    assessment: RiskAssessment,
    policy: PolicyRecord,
  ): number {
    if (decision !== 'approved') {
      return 0;
    }
    return Math.round(policy.premiumCents * assessment.premiumMultiplier);
  }

  /**
   * Tell the Policy API what happened. An approval or referral is recorded as
   * an underwriting result; a decline also cancels the draft policy so it is
   * not left open.
   */
  private async recordWithPolicyApi(
    event: PolicyApplicationEvent,
    decision: UnderwritingDecision['decision'],
    assessment: RiskAssessment,
    premiumCents: number,
  ): Promise<void> {
    await policyApi.underwritePolicy(event.policyId, {
      riskScore: assessment.riskScore,
      notes: `${decision} by underwriting-worker; premium ${premiumCents} cents; ${assessment.reasons.join('; ')}`,
    });

    if (decision === 'declined') {
      await policyApi.cancelPolicy(event.policyId);
    }
  }
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}
