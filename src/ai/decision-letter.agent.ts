import { Injectable, Inject, Logger } from '@nestjs/common';
import { GoogleAI } from '@google/generative-ai';
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
 * Runs Google Gemini 3.8 Flash via the Interactions API. This one writes
 * customer-facing prose rather than making a decision, so it runs on a
 * cheaper, faster model than risk scoring, and it is deliberately given only
 * the decision, the premium and the already-sanitised reasons — never the
 * application, the address or the claims history.
 *
 * The letter it returns is stored alongside the decision and then sent by
 * MailService through SendGrid.
 */

/** Shape of the structured JSON envelope Gemini returns. */
interface LetterEnvelope {
  letter: string;
  wordCount: number;
}

/** JSON response schema passed to the Interactions API. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    letter: {
      type: 'string',
      description: 'The full decision letter body, plain text.',
    },
    wordCount: {
      type: 'integer',
      description: 'The number of words in the letter field.',
    },
  },
  required: ['letter', 'wordCount'],
};

@Injectable()
export class DecisionLetterAgent {
  private readonly logger = new Logger(DecisionLetterAgent.name);
  private readonly config = AI_MODELS.decisionLetter;
  private readonly client: GoogleAI;

  constructor(@Inject(WORKER_CONFIG) workerConfig: WorkerConfig) {
    this.client = new GoogleAI({ apiKey: workerConfig.googleApiKey });
  }

  /** The model id this agent runs, for the decision audit row. */
  get modelId(): string {
    return this.config.modelId;
  }

  async draft(input: DecisionLetterInput): Promise<string> {
    const response = await this.client.interactions.create({
      model: this.config.modelId,
      input: buildDecisionLetterPrompt(input),
      config: {
        systemInstruction: DECISION_LETTER_SYSTEM_PROMPT,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    let envelope: LetterEnvelope;
    try {
      envelope = JSON.parse(response.text) as LetterEnvelope;
    } catch {
      throw new Error(
        `Decision letter agent returned unparseable JSON for policy ${input.policyNumber}`,
      );
    }

    const { letter, wordCount } = envelope;

    if (!letter) {
      throw new Error(
        `Decision letter agent returned an empty letter for policy ${input.policyNumber}`,
      );
    }

    // A truncated letter would reach the customer mid-sentence, so short
    // output is treated as a failure rather than sent.
    if (wordCount < 60) {
      this.logger.warn(
        `Decision letter for policy ${input.policyNumber} came back unusually short`,
      );
    }

    return letter.trim();
  }
}
