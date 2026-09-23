import { Module } from '@nestjs/common';
import { DecisionsRepository } from './decisions.repository';

@Module({
  providers: [DecisionsRepository],
  exports: [DecisionsRepository],
})
export class DbModule {}
