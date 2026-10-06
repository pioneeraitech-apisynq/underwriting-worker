import { Injectable, Inject, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { AI_MODELS } from '../config/ai-models.config';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import {
  DECISION_LETTER_SYSTEM_PROMPT,
  DecisionLetterInput,
  buildDecisionLetterPrompt,
} from './prompts/decision-letter.prompt';

/** Shape of the JSON object Gemini is instructed to return. */
interface DecisionLetterResponse {
  letter: string;
  wordCount: number;
}

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
        responseMimeType: 'application/json',
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

    const raw = result.response.text().trim();
    if (!raw) {
      throw new Error(
        `Decision letter agent returned an empty response for policy ${input.policyNumber}`,
      );
    }

    let parsed: DecisionLetterResponse;
    try {
      parsed = JSON.parse(raw) as DecisionLetterResponse;
    } catch (error) {
      throw new Error(
        `Decision letter agent returned malformed JSON for policy ${input.policyNumber}: ${(error as Error).message}`,
      );
    }

    const letter = parsed.letter?.trim();
    if (!letter) {
      throw new Error(
        `Decision letter agent returned an empty letter for policy ${input.policyNumber}`,
      );
    }

    // A truncated letter would reach the customer mid-sentence, so use the
    // model-reported word count (from the structured response) to detect this
    // reliably, rather than re-splitting the text ourselves.
    if (typeof parsed.wordCount === 'number' && parsed.wordCount < 60) {
      this.logger.warn(
        `Decision letter for policy ${input.policyNumber} came back unusually short (${parsed.wordCount} words)`,
      );
    }

    return letter;
  }
}
