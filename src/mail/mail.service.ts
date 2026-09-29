import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Uses a SendGrid Dynamic Template (Handlebars) so that formatting and
 * personalisation are owned by the template in the SendGrid dashboard.
 * The service supplies the structured data; the template renders the prose.
 */

export interface DecisionLetterMail {
  to: string;
  applicantName: string;
  policyNumber: string;
  decision: 'approved' | 'referred' | 'declined';
  /** Structured variables forwarded to the Handlebars Dynamic Template. */
  dynamicTemplateData: {
    applicantName: string;
    policyNumber: string;
    decision: 'approved' | 'referred' | 'declined';
    /** Formatted premium string, e.g. "$1,200.00 / yr". Empty for non-approvals. */
    premium: string;
  };
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
      templateId: this.config.decisionLetterTemplateId,
      dynamicTemplateData: mail.dynamicTemplateData,
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
