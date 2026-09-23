import { Module } from '@nestjs/common';
import { UnderwritingModule } from '../underwriting/underwriting.module';
import { ApplicationConsumerService } from './application-consumer.service';

@Module({
  imports: [UnderwritingModule],
  providers: [ApplicationConsumerService],
})
export class KafkaModule {}
