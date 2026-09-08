import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async createBooking(userId: string, slotId: string) {
    return await this.prisma.$transaction(async (tx) => {
      // Fetch the slot to ensure it exists and lock it for update to prevent concurrent bookings
      const slots: any[] = await tx.$queryRaw`
        SELECT id, price, "isBlocked" 
        FROM "TimeSlot" 
        WHERE id = ${slotId} 
        FOR UPDATE
      `;

      if (slots.length === 0) {
        throw new NotFoundException('Time slot not found');
      }

      const slot = slots[0];

      if (slot.isBlocked) {
        throw new ConflictException('This time slot is blocked for maintenance or other reasons');
      }

      // Check if there are any existing pending or confirmed bookings for this slot
      const existingBooking = await tx.booking.findFirst({
        where: {
          slotId: slotId,
          status: {
            in: ['PENDING', 'CONFIRMED'],
          },
        },
      });

      if (existingBooking) {
        throw new ConflictException('This time slot is already booked or pending payment');
      }

      // Create the new booking — price is loaded from TimeSlot (server-authoritative)
      // Client-provided prices are never trusted
      const newBooking = await tx.booking.create({
        data: {
          userId,
          slotId,
          totalAmount: slot.price, // server-authoritative: always from TimeSlot.price
          status: 'PENDING',
        },
      });

      return newBooking;
    });
  }

  async getUserBookings(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        slot: {
          include: {
            ground: {
              include: {
                turf: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
