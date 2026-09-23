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
    const [response] = await sendgrid.send({
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
