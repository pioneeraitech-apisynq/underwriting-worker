import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CacheModule } from '../cache/cache.module';
import { DbModule } from '../db/db.module';
import { MailModule } from '../mail/mail.module';
import { UnderwritingService } from './underwriting.service';

@Module({
  imports: [AiModule, CacheModule, DbModule, MailModule],
  providers: [UnderwritingService],
  exports: [UnderwritingService],
})
export class UnderwritingModule {}
