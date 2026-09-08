import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ProfilesModule } from './profiles/profiles.module';
import { TurfsModule } from './turfs/turfs.module';
import { GroundsModule } from './grounds/grounds.module';
import { BookingsModule } from './bookings/bookings.module';
import { GamesModule } from './games/games.module';
import { FriendsModule } from './friends/friends.module';
import { ChatModule } from './chat/chat.module';
import { ClansModule } from './clans/clans.module';
import { GamificationModule } from './gamification/gamification.module';
import { TimeSlotsModule } from './timeslots/timeslots.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    UsersModule,
    ProfilesModule,
    TurfsModule,
    GroundsModule,
    BookingsModule,
    GamesModule,
    FriendsModule,
    ChatModule,
    ClansModule,
    GamificationModule,
    TimeSlotsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
