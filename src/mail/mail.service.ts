import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Each decision type maps to a dedicated SendGrid Dynamic Template
 * (approved / referred / declined). Template layout, branding, and legal
 * copy are managed in the SendGrid dashboard; this service supplies only
 * the personalisation data via `dynamicTemplateData`.
 */

export interface DecisionLetterMail {
  to: string;
  applicantName: string;
  policyNumber: string;
  decision: 'approved' | 'referred' | 'declined';
  /** AI-generated prose surfaced as {{body}} in the Dynamic Template. */
  body: string;
  /** Annual premium in cents; 0 for referred/declined. */
  premiumCents: number;
  /** Short human-readable decision drivers from the risk assessment. */
  reasons: string[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {
    sendgrid.setApiKey(this.config.sendgridApiKey);
  }

  async sendDecisionLetter(mail: DecisionLetterMail): Promise<void> {
    const templateId = this.config.decisionLetterTemplateIds[mail.decision];

    try {
      const [response] = await sendgrid.send({
        to: { email: mail.to, name: mail.applicantName },
        from: {
          email: this.config.decisionLetterFromEmail,
          name: 'Digital Insurance Underwriting',
        },
        replyTo: this.config.decisionLetterReplyTo,
        subject: subjectFor(mail.decision, mail.policyNumber),
        templateId,
        dynamicTemplateData: {
          applicantName: mail.applicantName,
          policyNumber: mail.policyNumber,
          decision: mail.decision,
          body: mail.body,
          premiumCents: mail.premiumCents,
          reasons: mail.reasons,
        },
        categories: ['underwriting-decision', `decision-${mail.decision}`],
        customArgs: {
          policyNumber: mail.policyNumber,
          decision: mail.decision,
        },
      });

      this.logger.log(
        `Decision letter for policy ${mail.policyNumber} accepted by SendGrid (${response.statusCode})`,
      );
    } catch (error: unknown) {
      const responseBody =
        (error as { response?: { body?: unknown } })?.response?.body;
      this.logger.error(
        `SendGrid rejected decision letter for policy ${mail.policyNumber}: ${JSON.stringify(responseBody ?? error)}`,
      );
      throw error;
    }
  }
}

function subjectFor(
  decision: DecisionLetterMail['decision'],
  policyNumber: string,
): string {
  switch (decision) {
    case 'approved':
      return `Your policy ${policyNumber} has been approved`;
    case 'referred':
      return `We are reviewing your application for policy ${policyNumber}`;
    case 'declined':
      return `A decision on your application for policy ${policyNumber}`;
  }
}
