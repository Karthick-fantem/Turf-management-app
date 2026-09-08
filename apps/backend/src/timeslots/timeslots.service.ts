import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTimeSlotDto } from "./create-timeslot.dto";

// Asia/Kolkata = UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Parse a YYYY-MM-DD date string as the start and end of that business day
 * in Asia/Kolkata (UTC+5:30).
 *
 * "2026-09-10" → { start: 2026-09-09T18:30:00Z, end: 2026-09-10T18:29:59.999Z }
 */
function istDayBounds(dateStr: string): { start: Date; end: Date } {
  // Treat the string as IST midnight
  const [year, month, day] = dateStr.split("-").map(Number);
  // IST midnight = UTC date at previous day 18:30
  const startUtc = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS
  );
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: startUtc, end: endUtc };
}

@Injectable()
export class TimeSlotsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private validateTimeRange(startTime: Date, endTime: Date) {
    if (startTime >= endTime) {
      throw new BadRequestException("startTime must be before endTime");
    }
  }

  private validatePrice(price: number) {
    if (!Number.isInteger(price) || price < 0) {
      throw new BadRequestException("price must be a non-negative integer");
    }
  }

  /**
   * Check for any existing slot on the same ground whose interval overlaps
   * [startTime, endTime).  Excludes `excludeSlotId` (used on PATCH).
   *
   * Overlap condition:  existing.startTime < newEnd  AND  existing.endTime > newStart
   * Adjacent slots (e.g. 08:00-09:00 next to 07:00-08:00) do NOT overlap.
   */
  private async checkOverlap(
    tx: any,
    groundId: string,
    startTime: Date,
    endTime: Date,
    excludeSlotId?: string
  ) {
    const overlapping = await tx.timeSlot.findFirst({
      where: {
        groundId,
        id: excludeSlotId ? { not: excludeSlotId } : undefined,
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        `TimeSlot overlaps with existing slot ${overlapping.id} ` +
          `(${overlapping.startTime.toISOString()}–${overlapping.endTime.toISOString()})`
      );
    }
  }

  /**
   * Load a slot with its ground+turf and verify the requesting user owns the turf.
   * Returns the slot (with ground.turf.ownerId populated).
   */
  private async findSlotAndVerifyOwnership(slotId: string, userId: string) {
    const slot = await this.prisma.timeSlot.findUnique({
      where: { id: slotId },
      include: { ground: { include: { turf: true } } },
    });
    if (!slot) throw new NotFoundException(`TimeSlot ${slotId} not found`);

    if (slot.ground.turf.ownerId !== userId) {
      throw new ForbiddenException(
        "You do not own this slot. Ownership: TimeSlot → Ground → Turf → ownerId"
      );
    }
    return slot;
  }

  /**
   * Check whether a slot has any PENDING or CONFIRMED booking.
   * Used to block modifications to booked slots.
   */
  private async getActiveBooking(tx: any, slotId: string) {
    return tx.booking.findFirst({
      where: {
        slotId,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OWNER OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async createSlot(userId: string, dto: CreateTimeSlotDto) {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    this.validateTimeRange(startTime, endTime);
    this.validatePrice(dto.price);

    // Verify ground exists and owner matches through Ground → Turf → ownerId
    const ground = await this.prisma.ground.findUnique({
      where: { id: dto.groundId },
      include: { turf: true },
    });
    if (!ground) throw new NotFoundException(`Ground ${dto.groundId} not found`);
    if (ground.turf.ownerId !== userId) {
      throw new ForbiddenException(
        "You do not own this ground. Ownership: Ground → Turf → ownerId"
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.checkOverlap(tx, dto.groundId, startTime, endTime);

      return tx.timeSlot.create({
        data: {
          groundId: dto.groundId,
          startTime,
          endTime,
          price: dto.price,
          isBlocked: false,
        },
      });
    });
  }

  async updateSlot(
    userId: string,
    slotId: string,
    dto: Partial<{ startTime: string; endTime: string; price: number }>
  ) {
    const slot = await this.findSlotAndVerifyOwnership(slotId, userId);

    const newStart = dto.startTime ? new Date(dto.startTime) : slot.startTime;
    const newEnd = dto.endTime ? new Date(dto.endTime) : slot.endTime;

    this.validateTimeRange(newStart, newEnd);
    if (dto.price !== undefined) this.validatePrice(dto.price);

    const timeChanged =
      newStart.getTime() !== slot.startTime.getTime() ||
      newEnd.getTime() !== slot.endTime.getTime();

    const priceOrTimeChanging =
      timeChanged || (dto.price !== undefined && dto.price !== slot.price);

    return this.prisma.$transaction(async (tx) => {
      // If time or price is changing, reject if there is an active booking
      if (priceOrTimeChanging) {
        const activeBooking = await this.getActiveBooking(tx, slotId);
        if (activeBooking) {
          throw new ConflictException(
            "Cannot modify a TimeSlot that has a PENDING or CONFIRMED booking"
          );
        }
      }

      // Check overlap if time interval is changing (exclude self)
      if (timeChanged) {
        await this.checkOverlap(tx, slot.groundId, newStart, newEnd, slotId);
      }

      return tx.timeSlot.update({
        where: { id: slotId },
        data: {
          ...(dto.startTime ? { startTime: newStart } : {}),
          ...(dto.endTime ? { endTime: newEnd } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
        },
      });
    });
  }

  async blockSlot(userId: string, slotId: string) {
    await this.findSlotAndVerifyOwnership(slotId, userId);

    return this.prisma.$transaction(async (tx) => {
      const activeBooking = await this.getActiveBooking(tx, slotId);
      if (activeBooking) {
        throw new ConflictException(
          "Cannot block a TimeSlot that has a PENDING or CONFIRMED booking"
        );
      }
      return tx.timeSlot.update({
        where: { id: slotId },
        data: { isBlocked: true },
      });
    });
  }

  async unblockSlot(userId: string, slotId: string) {
    await this.findSlotAndVerifyOwnership(slotId, userId);

    return this.prisma.timeSlot.update({
      where: { id: slotId },
      data: { isBlocked: false },
    });
  }

  async deleteSlot(userId: string, slotId: string) {
    await this.findSlotAndVerifyOwnership(slotId, userId);

    return this.prisma.$transaction(async (tx) => {
      // Reject if any booking (PENDING, CONFIRMED, or historical CANCELLED)
      const anyBooking = await tx.booking.findFirst({ where: { slotId } });
      if (anyBooking) {
        throw new ConflictException(
          "Cannot delete a TimeSlot that has booking history. Block it instead."
        );
      }

      // Reject if a Game references this slot (Game is not a booking but slot is in use)
      const game = await tx.game.findFirst({ where: { slotId } });
      if (game) {
        throw new ConflictException(
          "Cannot delete a TimeSlot that is referenced by a Game. Block it instead."
        );
      }

      return tx.timeSlot.delete({ where: { id: slotId } });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC PLAYER DISCOVERY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /turfs/:id/slots?date=YYYY-MM-DD&groundId=xxx
   *
   * Returns all non-blocked slots for a turf on the given IST business date.
   * Each slot includes isAvailable derived from absence of PENDING/CONFIRMED booking.
   *
   * Visibility rules:
   *   BLOCKED   → excluded entirely
   *   PENDING   → included, isAvailable: false
   *   CONFIRMED → included, isAvailable: false
   *   no booking → included, isAvailable: true
   */
  async getPublicSlotsForTurf(
    turfId: string,
    date?: string,
    groundId?: string
  ) {
    // Verify turf exists
    const turf = await this.prisma.turf.findUnique({
      where: { id: turfId },
      select: { id: true, name: true },
    });
    if (!turf) throw new NotFoundException(`Turf ${turfId} not found`);

    const dateFilter =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? istDayBounds(date)
        : undefined;

    const slots = await this.prisma.timeSlot.findMany({
      where: {
        isBlocked: false,
        ground: {
          turfId,
          ...(groundId ? { id: groundId } : {}),
        },
        ...(dateFilter
          ? {
              startTime: { gte: dateFilter.start, lte: dateFilter.end },
            }
          : {}),
      },
      include: {
        ground: { select: { id: true, name: true, sport: true } },
        bookings: {
          where: { status: { in: ["PENDING", "CONFIRMED"] } },
          select: { id: true, status: true },
          take: 1,
        },
      },
      orderBy: [{ ground: { name: "asc" } }, { startTime: "asc" }],
    });

    return slots.map((slot) => ({
      id: slot.id,
      groundId: slot.groundId,
      ground: slot.ground,
      startTime: slot.startTime,
      endTime: slot.endTime,
      price: slot.price,
      isAvailable: slot.bookings.length === 0,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SLOT VALIDATION FOR GAME CREATION (used by GamesService)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify a slot exists and is not blocked.
   * Does NOT create a booking. Game creation does not reserve the slot.
   */
  async validateSlotForGame(slotId: string) {
    const slot = await this.prisma.timeSlot.findUnique({
      where: { id: slotId },
    });
    if (!slot) throw new NotFoundException(`TimeSlot ${slotId} not found`);
    if (slot.isBlocked) {
      throw new ConflictException(
        "Selected TimeSlot is blocked and cannot be used for a Game"
      );
    }
    return slot;
  }
}
