import { Module } from "@nestjs/common";
import { TimeSlotsService } from "./timeslots.service";
import { TimeSlotsController } from "./timeslots.controller";

@Module({
  providers: [TimeSlotsService],
  controllers: [TimeSlotsController],
  exports: [TimeSlotsService],
})
export class TimeSlotsModule {}
