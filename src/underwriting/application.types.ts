/**
 * Shapes shared across the worker: what arrives on Kafka, what the risk
 * scoring agent returns, and what ends up in Postgres.
 */

/** Property details carried on a new-business application. */
export interface PropertyDetails {
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  yearBuilt?: number;
  constructionType?: string;
  roofAgeYears?: number;
  squareFeet?: number;
  distanceToFireStationKm?: number;
  floodZone?: string;
}

/** The applicant as described on the application form. */
export interface Applicant {
  customerId: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  yearsAtAddress?: number;
  creditBand?: 'excellent' | 'good' | 'fair' | 'poor';
  priorInsurerLapseMonths?: number;
}

/**
 * The Kafka message. Produced by the Digital Insurance API when a customer
 * submits an application; the policy itself already exists in the Policy API
 * in `draft` status, which is why both identifiers travel with the event.
 */
export interface PolicyApplicationEvent {
  applicationId: string;
  /** Policy API identifier — used on GET /v1/policies/{policyId}. */
  policyId: string;
  /** Customer-facing policy number — used to look up prior claims. */
  policyNumber: string;
  productType: string;
  coverageAmountCents: number;
  termMonths: number;
  applicant: Applicant;
  property?: PropertyDetails;
  submittedAt: string;
}

/** A prior claim, as returned by the Claims API. */
export interface PriorClaim {
  claimId: string;
  policyNumber: string;
  status: string;
  lossType?: string;
  amountCents?: number;
  incidentDate?: string;
}

/** The policy record held by the Policy API. */
export interface PolicyRecord {
  id: string;
  customerId: string;
  productType: string;
  status: string;
  coverageAmountCents: number;
  termMonths: number;
  premiumCents: number;
  createdAt: string;
}

/** What the risk scoring agent produces. */
export interface RiskAssessment {
  /** 0 (lowest risk) to 100 (highest risk). */
  riskScore: number;
  recommendation: 'approve' | 'refer' | 'decline';
  /** Short reasons, one per driver of the score. */
  reasons: string[];
  /** Surcharge or discount applied to the base premium, as a multiplier. */
  premiumMultiplier: number;
  /** 0 to 1, how confident the model is in the score. */
  confidence: number;
}

/** The decision this worker commits to Postgres. */
export interface UnderwritingDecision {
  applicationId: string;
  policyId: string;
  policyNumber: string;
  customerId: string;
  decision: 'approved' | 'referred' | 'declined';
  riskScore: number;
  premiumCents: number;
  reasons: string[];
  priorClaimCount: number;
  modelId: string;
  letterModelId: string;
  letterBody: string;
  decidedAt: string;
}
