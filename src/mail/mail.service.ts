import { Inject, Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';

/**
 * Delivery of decision letters through SendGrid.
 *
 * The body is whatever the decision letter agent wrote; this service only
 * decides the subject, the addresses and the category the mail is tagged with
 * so delivery can be reported on per decision type.
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
    let response: Awaited<ReturnType<typeof sendgrid.send>>[0];

    try {
      [response] = await sendgrid.send({
        to: { email: mail.to, name: mail.applicantName },
        from: {
          email: this.config.decisionLetterFromEmail,
          name: 'Digital Insurance Underwriting',
        },
        replyTo: this.config.decisionLetterReplyTo,
        subject: subjectFor(mail.decision, mail.policyNumber),
        text: mail.body,
        categories: ['underwriting-decision', `decision-${mail.decision}`],
        customArgs: {
          policyNumber: mail.policyNumber,
          decision: mail.decision,
        },
      });
    } catch (error: any) {
      const statusCode: number | undefined = error?.code ?? error?.response?.statusCode;
      const body = error?.response?.body;

      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        // 4xx — permanent failure (bad address, invalid key, suppression list,
        // etc.). Re-queuing cannot fix this, so log the SendGrid error body and
        // dead-letter the message by returning without throwing.
        this.logger.error(
          `Decision letter for policy ${mail.policyNumber} permanently rejected by SendGrid (${statusCode}) — skipping`,
          JSON.stringify(body),
        );
        return;
      }

      // 5xx or network error — transient. Log the SendGrid error body for
      // debugging and re-throw so kafkajs redelivers the message.
      this.logger.error(
        `Decision letter for policy ${mail.policyNumber} failed with transient SendGrid error (${statusCode ?? 'unknown'}) — will retry`,
        JSON.stringify(body),
      );
      throw error;
    }

    this.logger.log(
      `Decision letter for policy ${mail.policyNumber} accepted by SendGrid (${response.statusCode})`,
    );
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
