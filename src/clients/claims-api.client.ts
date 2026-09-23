import axios from 'axios';
import { PriorClaim } from '../underwriting/application.types';

/**
 * Client for the internal Claims API.
 *
 * Prior loss history is the single biggest input to the risk score, and the
 * Claims API owns it. We only read here — triage belongs to the claims
 * handlers, not to underwriting. The base URL comes from CLAIMS_API_URL and
 * the full path template is written out at each call site.
 */

/**
 * List the claims filed against a policy number.
 * GET {CLAIMS_API_URL}/v1/claims?policyNumber={policyNumber}
 */
export async function listClaimsByPolicyNumber(
  policyNumber: string,
): Promise<PriorClaim[]> {
  const response = await axios.get(
    `${process.env.CLAIMS_API_URL}/v1/claims`,
    {
      params: { policyNumber },
      timeout: 10_000,
    },
  );
  const body = response.data as PriorClaim[] | { claims?: PriorClaim[] };
  // The Claims API returns a bare array; tolerate an envelope so a later
  // pagination change here does not turn into an empty claims history.
  return Array.isArray(body) ? body : body.claims ?? [];
}

/**
 * Fetch one claim in full, used when a summary row is not enough to explain a
 * referral to a human underwriter.
 * GET {CLAIMS_API_URL}/v1/claims/{claimId}
 */
export async function getClaim(claimId: string): Promise<PriorClaim> {
  const response = await axios.get(
    `${process.env.CLAIMS_API_URL}/v1/claims/${claimId}`,
    { timeout: 10_000 },
  );
  return response.data as PriorClaim;
}
