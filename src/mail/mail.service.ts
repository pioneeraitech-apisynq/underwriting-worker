import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * Layout and copy live in the SendGrid Dynamic Template identified by
 * `decisionLetterTemplateId`; this service only supplies the structured data
 * that the Handlebars template needs to render the final email.
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
        subject: subjectFor(mail.decision, mail.policyNumber),
        // Dynamic Template renders both HTML and plain-text parts; structured
        // fields decouple layout/branding from the worker code and let
        // non-developers edit letter copy in the SendGrid dashboard.
        templateId: this.config.decisionLetterTemplateId,
        dynamicTemplateData: {
          applicantName: mail.applicantName,
          policyNumber: mail.policyNumber,
          decision: mail.decision,
          letterBody: mail.body,
          subject: subjectFor(mail.decision, mail.policyNumber),
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
    } catch (err: any) {
      // SendGrid attaches the full API error payload to error.response.body.
      // Log it before re-throwing so the details are visible in the worker
      // logs even when the outer Kafka consumer only records the message.
      const detail = err?.response?.body ?? err?.message ?? err;
      this.logger.error(
        `SendGrid rejected decision letter for policy ${mail.policyNumber}: ${JSON.stringify(detail)}`,
      );
      throw new Error(
        `Failed to send decision letter for policy ${mail.policyNumber}: ${JSON.stringify(detail)}`,
      );
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
