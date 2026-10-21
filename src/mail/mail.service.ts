import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Each decision type has its own Dynamic Template in SendGrid. The AI-drafted
 * letter body and applicant details are forwarded as `dynamicTemplateData` so
 * the Handlebars template can control layout and branding while still embedding
 * the personalised prose produced by the decision-letter agent.
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
    try {
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
    } catch (error) {
      this.logger.error(
        `SendGrid rejected decision letter for policy ${mail.policyNumber}: ${error instanceof Error ? error.message : String(error)}`,
        (error as any)?.response?.body,
      );
      throw error;
    }
  }
}
