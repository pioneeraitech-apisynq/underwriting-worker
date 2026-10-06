import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Email copy and layout are managed in SendGrid Dynamic Templates.  This
 * service supplies the per-message personalisation data (`applicantName`,
 * `policyNumber`, `decision`) and is responsible for routing, tagging and
 * error handling — it does not construct the email body itself.
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
    try {
      const [response] = await sendgrid.send({
        to: { email: mail.to, name: mail.applicantName },
        from: {
          email: this.config.decisionLetterFromEmail,
          name: 'Digital Insurance Underwriting',
        },
        replyTo: this.config.decisionLetterReplyTo,
        subject: subjectFor(mail.decision, mail.policyNumber),
        templateId: this.config.decisionLetterTemplateId,
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
    } catch (error: any) {
      this.logger.error(
        `Failed to send decision letter for policy ${mail.policyNumber}`,
        error.response?.body ?? error.message,
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
