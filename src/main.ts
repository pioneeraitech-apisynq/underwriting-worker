import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Entry point.
 *
 * This is a standalone Nest application context, not an HTTP server: nothing
 * listens on a port and there is no OpenAPI contract. The process starts, the
 * Kafka consumer subscribes in its onModuleInit, and the context stays alive
 * until the platform signals a shutdown.
 */
async function bootstrap() {
  const logger = new Logger('UnderwritingWorker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
  });

  // Gives the Kafka consumer, the Postgres pool and the Redis client a chance
  // to close cleanly on SIGTERM instead of losing an in-flight application.
  app.enableShutdownHooks();

  logger.log('Underwriting worker started');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} received, shutting down`);
      void app.close().then(() => process.exit(0));
    });
  }
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Underwriting worker failed to start', error);
  process.exit(1);
});
