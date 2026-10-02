import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Each decision outcome maps to a dedicated SendGrid Dynamic Template whose
 * Handlebars variables mirror the fields of {@link DecisionLetterMail}.
 * The AI-generated letter body is passed as `{{letterBody}}` so the template
 * can place it wherever appropriate without coupling layout to code.
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
    const templateId = this.config.decisionLetterTemplates[mail.decision];

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
    } catch (error: any) {
      const body = error?.response?.body;
      this.logger.error(
        `SendGrid rejected decision letter for policy ${mail.policyNumber}: ${JSON.stringify(body ?? error?.message)}`,
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
