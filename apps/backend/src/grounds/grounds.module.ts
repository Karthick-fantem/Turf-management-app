import { Module } from '@nestjs/common';
import { GroundsService } from './grounds.service';
import { GroundsController } from './grounds.controller';

@Module({
  providers: [GroundsService],
  controllers: [GroundsController]
})
export class GroundsModule {}
