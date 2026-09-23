import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { KafkaModule } from './kafka/kafka.module';

/**
 * There is no HTTP layer here and no controllers — this process is a Kafka
 * consumer. KafkaModule pulls in the underwriting pipeline, which pulls in the
 * agents, the cache, Postgres and SendGrid.
 */
@Module({
  imports: [ConfigModule, KafkaModule],
})
export class AppModule {}
