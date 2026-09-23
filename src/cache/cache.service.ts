import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import { PolicyRecord, PriorClaim } from '../underwriting/application.types';

/**
 * Redis cache in front of the two internal HTTP dependencies, plus the
 * in-flight guard that stops two consumers scoring the same application.
 *
 * Nothing here is authoritative: a cache miss always falls through to the
 * owning service, and a Redis outage degrades the worker to slower, not
 * broken.
 */
@Injectable()
export class CacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  /** Policies barely change while an application is in flight. */
  private static readonly POLICY_TTL_SECONDS = 300;
  /** Claims history is worth re-reading sooner. */
  private static readonly CLAIMS_TTL_SECONDS = 120;
  /** Long enough to cover a slow scoring run, short enough to self-heal. */
  private static readonly LOCK_TTL_SECONDS = 600;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.redis.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }

  async getPolicy(policyId: string): Promise<PolicyRecord | null> {
    return this.readJson<PolicyRecord>(`policy:${policyId}`);
  }

  async putPolicy(policy: PolicyRecord): Promise<void> {
    await this.writeJson(
      `policy:${policy.id}`,
      policy,
      CacheService.POLICY_TTL_SECONDS,
    );
  }

  async getPriorClaims(policyNumber: string): Promise<PriorClaim[] | null> {
    return this.readJson<PriorClaim[]>(`claims:${policyNumber}`);
  }

  async putPriorClaims(
    policyNumber: string,
    claims: PriorClaim[],
  ): Promise<void> {
    await this.writeJson(
      `claims:${policyNumber}`,
      claims,
      CacheService.CLAIMS_TTL_SECONDS,
    );
  }

  /**
   * Claim an application for this consumer. Returns false when another
   * consumer already holds it, in which case the message is acknowledged and
   * dropped rather than scored twice.
   */
  async acquireApplicationLock(applicationId: string): Promise<boolean> {
    try {
      const result = await this.redis.set(
        `lock:application:${applicationId}`,
        process.pid.toString(),
        'EX',
        CacheService.LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      // Without Redis we would rather score twice than stop underwriting.
      this.logger.warn(
        `Could not take the lock for ${applicationId}, proceeding: ${
          (error as Error).message
        }`,
      );
      return true;
    }
  }

  async releaseApplicationLock(applicationId: string): Promise<void> {
    try {
      await this.redis.del(`lock:application:${applicationId}`);
    } catch (error) {
      this.logger.warn(
        `Could not release the lock for ${applicationId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Cache read failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  private async writeJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `Cache write failed for ${key}: ${(error as Error).message}`,
      );
    }
  }
}
