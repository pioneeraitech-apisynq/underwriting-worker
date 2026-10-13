import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Each decision type maps to a pre-created SendGrid Dynamic Template that uses
 * Handlebars syntax for personalisation (applicantName, policyNumber, etc.).
 * Template wording can be updated in the SendGrid dashboard without a code
 * deployment.
 */

export interface DecisionLetterMail {
  to: string;
  applicantName: string;
  policyNumber: string;
  decision: 'approved' | 'referred' | 'declined';
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
