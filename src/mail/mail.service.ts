import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid Dynamic Templates.
 *
 * Each decision type (`approved`, `referred`, `declined`) has its own
 * SendGrid Dynamic Template whose subject line, body copy and Handlebars
 * merge fields are managed inside SendGrid's template editor — no prose lives
 * in this file.  The service resolves the right template ID from config and
 * passes the structured applicant data as `dynamicTemplateData` so the
 * template can render `{{applicantName}}`, `{{policyNumber}}`, etc.
 */

export interface DecisionLetterMail {
  to: string;
  applicantName: string;
  policyNumber: string;
  decision: 'approved' | 'referred' | 'declined';
  /** Additional merge fields forwarded verbatim to the Dynamic Template. */
  templateData?: Record<string, unknown>;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {
    sendgrid.setApiKey(this.config.sendgridApiKey);
  }

  async sendDecisionLetter(mail: DecisionLetterMail): Promise<void> {
    const templateId = this.config.decisionLetterTemplates[mail.decision];

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
        ...mail.templateData,
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
