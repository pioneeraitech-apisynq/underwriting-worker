import { Injectable, Inject, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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
 * Runs Google Gemini 2.0 Flash. This one writes customer-facing prose rather
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
  private readonly model: GenerativeModel;

  constructor(@Inject(WORKER_CONFIG) workerConfig: WorkerConfig) {
    const genAI = new GoogleGenerativeAI(workerConfig.googleApiKey);
    this.model = genAI.getGenerativeModel({
      model: this.config.modelId,
      systemInstruction: DECISION_LETTER_SYSTEM_PROMPT,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
      },
    });
  }

  /** The model id this agent runs, for the decision audit row. */
  get modelId(): string {
    return this.config.modelId;
  }

  async draft(input: DecisionLetterInput): Promise<string> {
    const result = await this.model.generateContent(
      buildDecisionLetterPrompt(input),
    );

    const letter = result.response.text().trim();
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
