import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  async createBooking(
    @Request() req,
    @Body('slotId') slotId: string,
  ) {
    return this.bookingsService.createBooking(req.user.id, slotId);
  }

  @Get('my-bookings')
  async getMyBookings(@Request() req) {
    return this.bookingsService.getUserBookings(req.user.id);
  }
}
