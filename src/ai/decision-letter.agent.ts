import { Injectable, Inject, Logger } from '@nestjs/common';
import { genai } from '@google/genai';
import { AI_MODELS } from '../config/ai-models.config';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import {
  DECISION_LETTER_SYSTEM_PROMPT,
  DecisionLetterInput,
  buildDecisionLetterPrompt,
} from './prompts/decision-letter.prompt';

/**
 * Structured output schema returned by the model.
 *
 * Wrapping the letter body in a JSON envelope lets the Interactions API
 * enforce field presence and type at the protocol level, replacing the
 * heuristic word-count check with an explicit machine-verifiable contract.
 */
interface DecisionLetterOutput {
  /** The full customer-facing letter body, plain text. */
  letterBody: string;
}

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
@Injectable()
export class DecisionLetterAgent {
  private readonly logger = new Logger(DecisionLetterAgent.name);
  private readonly config = AI_MODELS.decisionLetter;
  private readonly client: genai.Client;

  constructor(@Inject(WORKER_CONFIG) workerConfig: WorkerConfig) {
    this.client = new genai.Client({ apiKey: workerConfig.googleApiKey });
  }

  /** The model id this agent runs, for the decision audit row. */
  get modelId(): string {
    return this.config.modelId;
  }

  async draft(input: DecisionLetterInput): Promise<string> {
    const interaction = await this.client.interactions.create({
      model: this.config.modelId,
      input: buildDecisionLetterPrompt(input),
      config: {
        systemInstruction: DECISION_LETTER_SYSTEM_PROMPT,
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            letterBody: { type: 'string' },
          },
          required: ['letterBody'],
        },
      },
    });

    let output: DecisionLetterOutput;
    try {
      output = JSON.parse(interaction.output_text) as DecisionLetterOutput;
    } catch (error) {
      throw new Error(
        `Decision letter agent returned unparseable JSON for policy ${input.policyNumber}: ${(error as Error).message}`,
      );
    }

    const letter = output.letterBody?.trim();
    if (!letter) {
      throw new Error(
        `Decision letter agent returned an empty letter for policy ${input.policyNumber}`,
      );
    }

    // Word-count is still logged as a diagnostic, but the structured schema
    // guarantees the field is present and non-null before we reach this point.
    const wordCount = letter.split(/\s+/).length;
    if (wordCount < 60) {
      this.logger.warn(
        `Decision letter for policy ${input.policyNumber} came back unusually short (${wordCount} words)`,
      );
    }

    return letter;
  }
}
