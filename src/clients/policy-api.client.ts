import axios from 'axios';
import { PolicyRecord } from '../underwriting/application.types';

/**
 * Client for the internal Policy API.
 *
 * The application event on Kafka carries only identifiers and the form the
 * customer filled in; the authoritative policy record — coverage, term, the
 * premium the rating engine produced — lives in the Policy API. The base URL
 * comes from POLICY_API_URL and the full path template is written out at each
 * call site so both host and path stay visible.
 */

export interface UnderwriteDecisionBody {
  riskScore?: number;
  notes?: string;
}

export interface UnderwriteResult {
  policyId: string;
  decision: 'approved' | 'declined';
  premiumCents: number;
}

export interface PremiumQuote {
  policyId: string;
  premiumCents: number;
  currency: string;
}

/**
 * Fetch the policy behind an application.
 * GET {POLICY_API_URL}/v1/policies/{policyId}
 */
export async function getPolicy(policyId: string): Promise<PolicyRecord> {
  const response = await axios.get(
    `${process.env.POLICY_API_URL}/v1/policies/${policyId}`,
    { timeout: 10_000 },
  );
  return response.data as PolicyRecord;
}

/**
 * Ask the Policy API for its locally computed premium, which this worker uses
 * as the base the risk multiplier is applied to.
 * GET {POLICY_API_URL}/v1/policies/{policyId}/quote-premium
 */
export async function quotePremium(policyId: string): Promise<PremiumQuote> {
  const response = await axios.get(
    `${process.env.POLICY_API_URL}/v1/policies/${policyId}/quote-premium`,
    { timeout: 10_000 },
  );
  return response.data as PremiumQuote;
}

/**
 * Record the underwriting outcome against the policy so the policy leaves
 * `draft` and carries the rated premium.
 * POST {POLICY_API_URL}/v1/policies/{policyId}/underwrite
 */
export async function underwritePolicy(
  policyId: string,
  body: UnderwriteDecisionBody,
): Promise<UnderwriteResult> {
  const response = await axios.post(
    `${process.env.POLICY_API_URL}/v1/policies/${policyId}/underwrite`,
    body,
    { timeout: 10_000 },
  );
  return response.data as UnderwriteResult;
}

/**
 * Cancel a policy whose application was declined, so nothing is left sitting
 * in `draft` forever.
 * POST {POLICY_API_URL}/v1/policies/{policyId}/cancel
 */
export async function cancelPolicy(policyId: string): Promise<PolicyRecord> {
  const response = await axios.post(
    `${process.env.POLICY_API_URL}/v1/policies/${policyId}/cancel`,
    undefined,
    { timeout: 10_000 },
  );
  return response.data as PolicyRecord;
}
