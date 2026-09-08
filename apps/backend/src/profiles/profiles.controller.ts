import { Controller, Put, Body, UseGuards, Request } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @UseGuards(JwtAuthGuard)
  @Put('me')
  async updateMyProfile(
    @Request() req,
    @Body() body: { avatar?: string; favoriteSports?: string[] }
  ) {
    return this.profilesService.updateProfile(req.user.id, body);
  }
}
