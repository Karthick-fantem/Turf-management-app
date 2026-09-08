import { Controller, Post, Get, Param, UseGuards, Request } from '@nestjs/common';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  async getFriends(@Request() req) {
    return this.friendsService.getFriends(req.user.id);
  }

  @Post('request/:userId')
  async sendRequest(@Request() req, @Param('userId') targetUserId: string) {
    return this.friendsService.sendRequest(req.user.id, targetUserId);
  }

  @Post('accept/:requestId')
  async acceptRequest(@Request() req, @Param('requestId') requestId: string) {
    return this.friendsService.acceptRequest(req.user.id, requestId);
  }
}
