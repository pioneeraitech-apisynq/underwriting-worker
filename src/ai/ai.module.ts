import { Module } from '@nestjs/common';
import { RiskScoringAgent } from './risk-scoring.agent';
import { DecisionLetterAgent } from './decision-letter.agent';

/**
 * The two model-backed agents this worker runs. Model ids for both live in
 * src/config/ai-models.config.ts.
 */
@Module({
  providers: [RiskScoringAgent, DecisionLetterAgent],
  exports: [RiskScoringAgent, DecisionLetterAgent],
})
export class AiModule {}
