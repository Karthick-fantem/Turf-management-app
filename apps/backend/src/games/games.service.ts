import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  async createGame(userId: string, data: any) {
    // Validate slot exists and is not blocked.
    // Game creation does NOT create a Booking and does NOT reserve the TimeSlot.
    const slot = await this.prisma.timeSlot.findUnique({
      where: { id: data.slotId },
    });
    if (!slot) throw new NotFoundException(`TimeSlot ${data.slotId} not found`);
    if (slot.isBlocked) {
      throw new ConflictException('Selected TimeSlot is blocked and cannot be used for a Game');
    }

    // Transaction ensures the game and the host joining as a player are saved atomically
    return await this.prisma.$transaction(async (tx) => {
      const game = await tx.game.create({
        data: {
          hostId: userId,
          sport: data.sport,
          slotId: data.slotId,
          minPlayers: data.minPlayers,
          maxPlayers: data.maxPlayers,
          pricePerPlayer: data.pricePerPlayer,
          visibility: data.visibility || 'PUBLIC',
          guidelines: data.guidelines,
          players: {
            create: {
              userId,
              status: 'JOINED',
            }
          }
        },
      });

      return game;
    });
  }

  async getPublicGames() {
    return this.prisma.game.findMany({
      where: { visibility: 'PUBLIC' },
      include: {
        players: true,
        slot: {
          include: {
            ground: { include: { turf: true } }
          }
        }
      }
    });
  }

  async joinGame(userId: string, gameId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        include: { players: true }
      });

      if (!game) throw new NotFoundException('Game not found');

      const isJoined = game.players.find(p => p.userId === userId);
      if (isJoined) throw new ConflictException('You have already joined this game');

      if (game.players.length >= game.maxPlayers) {
        throw new ConflictException('This game has already reached maximum players');
      }

      return tx.gamePlayer.create({
        data: {
          gameId,
          userId,
          status: 'JOINED'
        }
      });
    });
  }
}
