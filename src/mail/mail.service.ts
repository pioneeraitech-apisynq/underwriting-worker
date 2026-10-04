import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid Dynamic Templates.
 *
 * Each decision outcome (approved / referred / declined) is mapped to its own
 * pre-built SendGrid Dynamic Template.  The template receives the applicant
 * name, policy number, and the AI-drafted letter body as Handlebars variables,
 * so brand-consistent HTML layout, A/B testing, and template versioning are
 * all controlled in the SendGrid dashboard — no code changes required.
 */

export interface DecisionLetterMail {
  to: string;
  applicantName: string;
  policyNumber: string;
  decision: 'approved' | 'referred' | 'declined';
  body: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {
    sendgrid.setApiKey(this.config.sendgridApiKey);
  }

  async sendDecisionLetter(mail: DecisionLetterMail): Promise<void> {
    const templateId =
      this.config.decisionLetterTemplateIds[mail.decision];

    const [response] = await sendgrid.send({
      to: { email: mail.to, name: mail.applicantName },
      from: {
        email: this.config.decisionLetterFromEmail,
        name: 'Digital Insurance Underwriting',
      },
      replyTo: this.config.decisionLetterReplyTo,
      templateId,
      dynamicTemplateData: {
        applicantName: mail.applicantName,
        policyNumber: mail.policyNumber,
        decision: mail.decision,
        letterBody: mail.body,
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
  }
}
