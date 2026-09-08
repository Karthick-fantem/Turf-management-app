import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

  async sendRequest(userId: string, targetUserId: string) {
    if (userId === targetUserId) throw new ConflictException('Cannot add yourself');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: targetUserId },
          { user1Id: targetUserId, user2Id: userId },
        ]
      }
    });

    if (existing) {
      throw new ConflictException('Friendship request already exists or you are already friends');
    }

    return this.prisma.friendship.create({
      data: {
        user1Id: userId,
        user2Id: targetUserId,
        status: 'PENDING'
      }
    });
  }

  async acceptRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.user2Id !== userId) {
      throw new NotFoundException('Friend request not found');
    }

    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: 'ACCEPTED' }
    });
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [ { user1Id: userId }, { user2Id: userId } ]
      }
    });
    
    // We would ideally fetch the actual user profiles for these IDs
    return friendships;
  }
}
