import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Each decision type (`approved`, `referred`, `declined`) is backed by its
 * own SendGrid Dynamic Template so that layout, styling and subject line are
 * managed in the SendGrid UI rather than in code.  The AI-generated letter
 * text is passed as `dynamicTemplateData.body` and referenced in the template
 * with `{{{body}}}` (triple-stache to preserve line breaks unescaped).
 *
 * The `from` address is always sourced from config — the config loader
 * enforces that it is set explicitly, preventing delivery failures caused by
 * an unverified sender domain.
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
    const [response] = await sendgrid.send({
      to: { email: mail.to, name: mail.applicantName },
      from: {
        email: this.config.decisionLetterFromEmail,
        name: 'Digital Insurance Underwriting',
      },
      replyTo: this.config.decisionLetterReplyTo,
      templateId: this.config.decisionLetterTemplateIds[mail.decision],
      dynamicTemplateData: {
        applicantName: mail.applicantName,
        policyNumber: mail.policyNumber,
        decision: mail.decision,
        body: mail.body,
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
