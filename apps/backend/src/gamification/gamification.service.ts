import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GamificationService {
  constructor(private prisma: PrismaService) {}

  async awardXP(userId: string, xpAmount: number) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const newXp = profile.xp + xpAmount;
    
    // Simple level up logic: Level 1 = 0-999 XP, Level 2 = 1000-1999 XP, etc.
    const newLevel = Math.floor(newXp / 1000) + 1;

    return this.prisma.profile.update({
      where: { userId },
      data: {
        xp: newXp,
        level: newLevel,
      }
    });
  }

  async awardBadge(userId: string, badgeId: string) {
    // Check if the user already has this badge
    const existing = await this.prisma.userBadge.findUnique({
      where: {
        userId_badgeId: { userId, badgeId }
      }
    });

    if (existing) return existing;

    return this.prisma.userBadge.create({
      data: {
        userId,
        badgeId
      }
    });
  }

  async getUserBadges(userId: string) {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true }
    });
  }
}
