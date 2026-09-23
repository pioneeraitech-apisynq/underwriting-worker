import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import { UnderwritingDecision } from '../underwriting/application.types';

/**
 * Postgres store for underwriting decisions.
 *
 * One connection pool for the process. Every decision is written exactly once
 * per application: Kafka can redeliver a message after a rebalance, so the
 * insert is an upsert keyed on application_id and the worker treats an
 * existing row as "already handled".
 */
@Injectable()
export class DecisionsRepository implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DecisionsRepository.name);
  private readonly pool: Pool;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.pool = new Pool({
      connectionString: config.postgresUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    // An error on an idle client is emitted on the pool, not on a query, and
    // would otherwise take the process down.
    this.pool.on('error', (error) => {
      this.logger.error(`Idle Postgres client error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  /** Applies db/schema.sql so a fresh database is usable on first boot. */
  async ensureSchema(): Promise<void> {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await this.pool.query(schema);
    this.logger.log('Underwriting decision schema is up to date');
  }

  async hasDecision(applicationId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM underwriting_decisions WHERE application_id = $1',
      [applicationId],
    );
    return result.rowCount > 0;
  }

  async save(decision: UnderwritingDecision): Promise<void> {
    await this.pool.query(
      `INSERT INTO underwriting_decisions (
         application_id, policy_id, policy_number, customer_id, decision,
         risk_score, premium_cents, reasons, prior_claim_count,
         model_id, letter_model_id, letter_body, decided_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
       ON CONFLICT (application_id) DO UPDATE SET
         decision = EXCLUDED.decision,
         risk_score = EXCLUDED.risk_score,
         premium_cents = EXCLUDED.premium_cents,
         reasons = EXCLUDED.reasons,
         prior_claim_count = EXCLUDED.prior_claim_count,
         model_id = EXCLUDED.model_id,
         letter_model_id = EXCLUDED.letter_model_id,
         letter_body = EXCLUDED.letter_body,
         decided_at = EXCLUDED.decided_at`,
      [
        decision.applicationId,
        decision.policyId,
        decision.policyNumber,
        decision.customerId,
        decision.decision,
        decision.riskScore,
        decision.premiumCents,
        JSON.stringify(decision.reasons),
        decision.priorClaimCount,
        decision.modelId,
        decision.letterModelId,
        decision.letterBody,
        decision.decidedAt,
      ],
    );
  }

  /** Recent decisions for a customer, used by ops when a case is queried. */
  async listForCustomer(
    customerId: string,
    limit = 20,
  ): Promise<UnderwritingDecision[]> {
    const result = await this.pool.query(
      `SELECT application_id, policy_id, policy_number, customer_id, decision,
              risk_score, premium_cents, reasons, prior_claim_count,
              model_id, letter_model_id, letter_body, decided_at
         FROM underwriting_decisions
        WHERE customer_id = $1
        ORDER BY decided_at DESC
        LIMIT $2`,
      [customerId, limit],
    );

    return result.rows.map((row) => ({
      applicationId: row.application_id,
      policyId: row.policy_id,
      policyNumber: row.policy_number,
      customerId: row.customer_id,
      decision: row.decision,
      riskScore: row.risk_score,
      premiumCents: Number(row.premium_cents),
      reasons: row.reasons ?? [],
      priorClaimCount: row.prior_claim_count,
      modelId: row.model_id,
      letterModelId: row.letter_model_id,
      letterBody: row.letter_body,
      decidedAt: new Date(row.decided_at).toISOString(),
    }));
  }
}
