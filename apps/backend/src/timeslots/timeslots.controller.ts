import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Body,
  Param,
  Request,
  Query,
} from "@nestjs/common";
import { TimeSlotsService } from "./timeslots.service";
import { CreateTimeSlotDto } from "./create-timeslot.dto";
import { Roles } from "../auth/roles.decorator";
import { Role } from "@prisma/client";

/**
 * TimeSlotsController
 *
 * Owner management routes:  JWT + TURF_OWNER role (via global guards)
 *   POST   /timeslots               – Create a slot
 *   PATCH  /timeslots/:id           – Update slot time/price (rejected if booked)
 *   PATCH  /timeslots/:id/block     – Block a slot (rejected if booked)
 *   PATCH  /timeslots/:id/unblock   – Unblock a slot
 *   DELETE /timeslots/:id           – Hard delete (rejected if any booking exists)
 *
 * Public player discovery is on TurfsController:
 *   GET    /turfs/:id/slots         – @Public(), see turfs.controller.ts
 */
@Controller("timeslots")
export class TimeSlotsController {
  constructor(private readonly timeSlotsService: TimeSlotsService) {}

  // ── Owner: Create ──────────────────────────────────────────────────────
  @Post()
  @Roles(Role.TURF_OWNER)
  async createSlot(@Request() req, @Body() dto: CreateTimeSlotDto) {
    return this.timeSlotsService.createSlot(req.user.id, dto);
  }

  // ── Owner: Update ──────────────────────────────────────────────────────
  @Patch(":id")
  @Roles(Role.TURF_OWNER)
  async updateSlot(
    @Request() req,
    @Param("id") slotId: string,
    @Body() body: Partial<{ startTime: string; endTime: string; price: number }>
  ) {
    return this.timeSlotsService.updateSlot(req.user.id, slotId, body);
  }

  // ── Owner: Block ───────────────────────────────────────────────────────
  @Patch(":id/block")
  @Roles(Role.TURF_OWNER)
  async blockSlot(@Request() req, @Param("id") slotId: string) {
    return this.timeSlotsService.blockSlot(req.user.id, slotId);
  }

  // ── Owner: Unblock ─────────────────────────────────────────────────────
  @Patch(":id/unblock")
  @Roles(Role.TURF_OWNER)
  async unblockSlot(@Request() req, @Param("id") slotId: string) {
    return this.timeSlotsService.unblockSlot(req.user.id, slotId);
  }

  // ── Owner: Delete ──────────────────────────────────────────────────────
  @Delete(":id")
  @Roles(Role.TURF_OWNER)
  async deleteSlot(@Request() req, @Param("id") slotId: string) {
    return this.timeSlotsService.deleteSlot(req.user.id, slotId);
  }
}
