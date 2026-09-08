import { Controller, Get, Param, Query } from '@nestjs/common';
import { TurfsService } from './turfs.service';
import { Public } from '../auth/public.decorator';
import { TimeSlotsService } from '../timeslots/timeslots.service';

@Public()
@Controller('turfs')
export class TurfsController {
  constructor(
    private readonly turfsService: TurfsService,
    private readonly timeSlotsService: TimeSlotsService,
  ) {}

  @Get()
  async findAll() {
    return this.turfsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.turfsService.findOne(id);
  }

  /**
   * GET /turfs/:id/slots?date=YYYY-MM-DD&groundId=xxx
   *
   * Public endpoint — no JWT required.
   * Returns owner-published TimeSlots for the turf.
   * Blocked slots are excluded. Active bookings (PENDING/CONFIRMED) mark isAvailable=false.
   * Date is interpreted in Asia/Kolkata (IST).
   */
  @Get(':id/slots')
  async getTurfSlots(
    @Param('id') turfId: string,
    @Query('date') date?: string,
    @Query('groundId') groundId?: string,
  ) {
    return this.timeSlotsService.getPublicSlotsForTurf(turfId, date, groundId);
  }
}
