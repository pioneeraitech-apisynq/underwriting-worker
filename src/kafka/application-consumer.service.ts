import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { WORKER_CONFIG, WorkerConfig } from '../config/worker.config';
import { UnderwritingService } from '../underwriting/underwriting.service';
import { PolicyApplicationEvent } from '../underwriting/application.types';

/**
 * The worker's only entry point: the policy-application topic.
 *
 * Offsets are committed by kafkajs once eachMessage resolves, so a thrown
 * error leaves the offset where it was and the message is redelivered.
 * Malformed messages are the exception — they would be redelivered forever,
 * so they are logged and skipped.
 */
@Injectable()
export class ApplicationConsumerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ApplicationConsumerService.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly underwriting: UnderwritingService,
  ) {
    this.kafka = new Kafka({
      clientId: this.config.kafka.clientId,
      brokers: this.config.kafka.brokers,
      ssl: true,
      sasl: {
        mechanism: 'scram-sha-512',
        username: this.config.kafka.saslUsername,
        password: this.config.kafka.saslPassword,
      },
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 8 },
    });

    this.consumer = this.kafka.consumer({
      groupId: this.config.kafka.groupId,
      // Scoring an application takes two model calls and three HTTP round
      // trips, so the consumer needs room before the broker calls it dead.
      sessionTimeout: 60_000,
      heartbeatInterval: 10_000,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.kafka.applicationsTopic,
      fromBeginning: false,
    });

    await this.consumer.run({
      // Applications for the same policy must not overlap, and partitioning
      // is by policy number, so one message at a time per partition is right.
      partitionsConsumedConcurrently: 3,
      eachMessage: (payload) => this.onMessage(payload),
    });

    this.logger.log(
      `Consuming ${this.config.kafka.applicationsTopic} as group ${this.config.kafka.groupId}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.disconnect();
    this.logger.log('Kafka consumer disconnected');
  }

  private async onMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    const raw = message.value?.toString('utf-8');
    if (!raw) {
      this.logger.warn(
        `Empty message at ${topic}[${partition}]@${message.offset}, skipping`,
      );
      return;
    }

    let event: PolicyApplicationEvent;
    try {
      event = JSON.parse(raw) as PolicyApplicationEvent;
    } catch (error) {
      // Poison message: retrying cannot fix it, so drop it and move on.
      this.logger.error(
        `Unparseable message at ${topic}[${partition}]@${message.offset}: ${
          (error as Error).message
        }`,
      );
      return;
    }

    const missing = missingFields(event);
    if (missing.length > 0) {
      this.logger.error(
        `Message at ${topic}[${partition}]@${message.offset} is missing ${missing.join(', ')}, skipping`,
      );
      return;
    }

    // Anything thrown from here is a transient failure of a dependency, so it
    // is allowed to propagate and the message is redelivered.
    await this.underwriting.handleApplication(event);
  }
}

function missingFields(event: PolicyApplicationEvent): string[] {
  const missing: string[] = [];
  if (!event?.applicationId) missing.push('applicationId');
  if (!event?.policyId) missing.push('policyId');
  if (!event?.policyNumber) missing.push('policyNumber');
  if (!event?.applicant?.customerId) missing.push('applicant.customerId');
  if (!event?.applicant?.email) missing.push('applicant.email');
  return missing;
}
