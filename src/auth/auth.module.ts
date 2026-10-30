import { Module } from '@nestjs/common';
import { SupportModule } from '../support/support.module';
import { UsersModule } from '../users/users.module';
import { InitDataGuard } from './init-data.guard';
import { MeController } from './me.controller';
import { ModeratorGuard } from './moderator.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { WebAuthController } from './web-auth.controller';
import { WebLoginService } from './web-login.service';

/**
 * Вход (initData мини-аппа, сессия сайта) и роль модератора. Nest собирает @UseGuards(InitDataGuard) в модуле контроллера,
 * поэтому UsersModule и SupportModule реэкспортируются: импортировать AuthModule — достаточно.
 */
@Module({
  imports: [UsersModule, SupportModule],
  controllers: [MeController, WebAuthController],
  providers: [
    InitDataGuard,
    ModeratorGuard,
    UserThrottlerGuard,
    WebLoginService,
  ],
  exports: [
    UsersModule,
    SupportModule,
    InitDataGuard,
    ModeratorGuard,
    UserThrottlerGuard,
    WebLoginService,
  ],
})
export class AuthModule {}
