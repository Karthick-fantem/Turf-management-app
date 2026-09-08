import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('badges')
  async getMyBadges(@Request() req) {
    return this.gamificationService.getUserBadges(req.user.id);
  }

  // Note: In a real production app, awarding XP/Badges should be done by internal 
  // services or admin controllers, not directly exposed to players like this.
  // This endpoint is just for demonstration / testing purposes.
  @Post('award-xp')
  async awardXp(@Request() req, @Body('xp') xp: number) {
    return this.gamificationService.awardXP(req.user.id, xp);
  }
}
