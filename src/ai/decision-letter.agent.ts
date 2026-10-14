import { Injectable, Inject, Logger } from '@nestjs/common';
import { AI_MODELS } from '../config/ai-models.config';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import {
  DECISION_LETTER_SYSTEM_PROMPT,
  DecisionLetterInput,
  buildDecisionLetterPrompt,
} from './prompts/decision-letter.prompt';

/**
 * Decision letter agent.
 *
 * Runs Google Gemini 3.8 Flash. This one writes customer-facing prose rather
 * than making a decision, so it runs on a cheaper, faster model than risk
 * scoring, and it is deliberately given only the decision, the premium and
 * the already-sanitised reasons — never the application, the address or the
 * claims history.
 *
 * The letter it returns is stored alongside the decision and then sent by
 * MailService through SendGrid.
 */
@Injectable()
export class DecisionLetterAgent {
  private readonly logger = new Logger(DecisionLetterAgent.name);
  private readonly config = AI_MODELS.decisionLetter;
  private readonly apiKey: string;

  constructor(@Inject(WORKER_CONFIG) workerConfig: WorkerConfig) {
    this.apiKey = workerConfig.googleApiKey;
  }

  /** The model id this agent runs, for the decision audit row. */
  get modelId(): string {
    return this.config.modelId;
  }

  async draft(input: DecisionLetterInput): Promise<string> {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.config.modelId,
          system: DECISION_LETTER_SYSTEM_PROMPT,
          input: buildDecisionLetterPrompt(input),
          temperature: this.config.temperature,
          max_output_tokens: this.config.maxOutputTokens,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Interactions API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    const letter: string = (data?.output ?? '').trim();

    if (!letter) {
      throw new Error(
        `Decision letter agent returned an empty letter for policy ${input.policyNumber}`,
      );
    }

    // A truncated letter would reach the customer mid-sentence, so short
    // output is treated as a failure rather than sent.
    if (letter.split(/\s+/).length < 60) {
      this.logger.warn(
        `Decision letter for policy ${input.policyNumber} came back unusually short`,
      );
    }

    return letter;
  }
}
