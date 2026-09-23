import { Global, Module } from '@nestjs/common';
import { loadWorkerConfig, WORKER_CONFIG } from './worker.config';

/**
 * Loads the environment once and hands the same config object to every other
 * module. Global so nothing has to re-import it.
 */
@Global()
@Module({
  providers: [
    {
      provide: WORKER_CONFIG,
      useFactory: loadWorkerConfig,
    },
  ],
  exports: [WORKER_CONFIG],
})
export class ConfigModule {}
