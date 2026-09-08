import { Controller, Post, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ClansService } from './clans.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('clans')
@UseGuards(JwtAuthGuard)
export class ClansController {
  constructor(private readonly clansService: ClansService) {}

  @Post()
  async createClan(
    @Request() req,
    @Body('name') name: string,
    @Body('description') description?: string
  ) {
    return this.clansService.createClan(req.user.id, name, description);
  }

  @Post(':id/join')
  async joinClan(@Request() req, @Param('id') clanId: string) {
    return this.clansService.joinClan(req.user.id, clanId);
  }

  @Get(':id')
  async getClan(@Param('id') clanId: string) {
    return this.clansService.getClan(clanId);
  }
}
