import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClansService {
  constructor(private prisma: PrismaService) {}

  async createClan(userId: string, name: string, description?: string) {
    // Wrap in transaction: create clan and add user as CAPTAIN
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.clan.findUnique({ where: { name } });
      if (existing) throw new ConflictException('Clan name already taken');

      return tx.clan.create({
        data: {
          name,
          description,
          members: {
            create: {
              userId,
              role: 'CAPTAIN'
            }
          }
        },
        include: { members: true }
      });
    });
  }

  async joinClan(userId: string, clanId: string) {
    const clan = await this.prisma.clan.findUnique({ where: { id: clanId } });
    if (!clan) throw new NotFoundException('Clan not found');

    const existingMember = await this.prisma.clanMember.findFirst({
      where: { clanId, userId }
    });

    if (existingMember) {
      throw new ConflictException('You are already a member of this clan');
    }

    return this.prisma.clanMember.create({
      data: {
        clanId,
        userId,
        role: 'MEMBER'
      }
    });
  }

  async getClan(clanId: string) {
    const clan = await this.prisma.clan.findUnique({
      where: { id: clanId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, phone: true } } }
        }
      }
    });

    if (!clan) throw new NotFoundException('Clan not found');
    return clan;
  }
}
