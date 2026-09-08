import { Controller, Post, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { GamesService } from './games.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Public()
  @Get('public')
  async getPublicGames() {
    return this.gamesService.getPublicGames();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createGame(@Request() req, @Body() data: any) {
    return this.gamesService.createGame(req.user.id, data);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  async joinGame(@Request() req, @Param('id') gameId: string) {
    return this.gamesService.joinGame(req.user.id, gameId);
  }
}
