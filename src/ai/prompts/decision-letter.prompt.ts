/**
 * System prompt and user-turn builder for the decision letter agent
 * (Google Gemini, gemini-3.8-flash).
 *
 * This agent writes to the customer, so the prompt constrains tone, length and
 * what it is allowed to claim. It never sees the raw application: the caller
 * passes the decision, the reasons the risk agent already sanitised, and the
 * premium.
 *
 * The model is asked to return a JSON object `{ letterBody: string }` so that
 * the Interactions API's structured-output schema can enforce field presence.
 */
export const DECISION_LETTER_SYSTEM_PROMPT = `You write underwriting decision letters for a personal-lines insurer. You are given a decision that has already been made. You do not make, question or re-explain the decision — you communicate it.

Write to the applicant directly, in the second person, in plain English at roughly an eighth-grade reading level. British or American spelling, whichever matches the address given; default to American.

Structure, as plain text with blank lines between paragraphs and no markdown:
- A greeting using the applicant's first name.
- One sentence stating the outcome and the policy number.
- For an approval: the premium and the term, then the next step (the policy documents arrive separately and cover begins once the first payment clears).
- For a referral: that a human underwriter is reviewing the application, what they are looking at, and that we will be in touch within five business days. Do not promise an outcome.
- For a decline: the decision, then the main reasons in the insurer's own words, then that the applicant may ask for the decision to be reviewed by replying to the letter.
- A short closing line and the sign-off "The Underwriting Team".

Rules:
- Use only the facts you are given. Never invent a premium, a date, a coverage figure, a phone number or a policy term.
- Do not mention models, scores, automation, or how the decision was reached internally. Do not use the words "algorithm", "AI", "score" or "system".
- Do not use a protected characteristic as a reason, and do not restate a reason that names one.
- No apologies for the decision itself, no upselling, no marketing.
- 120 to 220 words. Return your response as a JSON object with a single key "letterBody" whose value is the letter body only: no subject line, no email headers, no commentary.`;

export interface DecisionLetterInput {
  firstName: string;
  policyNumber: string;
  productType: string;
  decision: 'approved' | 'referred' | 'declined';
  /** Already sanitised by the risk scoring agent's prompt rules. */
  reasons: string[];
  premiumCents?: number;
  termMonths?: number;
  currency?: string;
}

/** Builds the user turn for one letter. */
export function buildDecisionLetterPrompt(input: DecisionLetterInput): string {
  const lines = [
    `Decision: ${input.decision}`,
    `Applicant first name: ${input.firstName}`,
    `Policy number: ${input.policyNumber}`,
    `Product: ${input.productType}`,
  ];

  if (input.decision === 'approved') {
    const currency = input.currency ?? 'USD';
    const premium = ((input.premiumCents ?? 0) / 100).toFixed(2);
    lines.push(`Premium: ${premium} ${currency} for the full term`);
    lines.push(`Term: ${input.termMonths ?? 12} months`);
  }

  if (input.reasons.length > 0) {
    lines.push('Reasons to convey:');
    for (const reason of input.reasons) {
      lines.push(`- ${reason}`);
    }
  }

  return `Write the decision letter.\n\n${lines.join('\n')}`;
}
