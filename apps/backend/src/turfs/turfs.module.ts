import { Module } from '@nestjs/common';
import { TurfsService } from './turfs.service';
import { TurfsController } from './turfs.controller';
import { TimeSlotsModule } from '../timeslots/timeslots.module';

@Module({
  imports: [TimeSlotsModule],
  providers: [TurfsService],
  controllers: [TurfsController]
})
export class TurfsModule {}
