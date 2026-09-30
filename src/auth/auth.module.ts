import { Module } from '@nestjs/common';
import { SupportModule } from '../support/support.module';
import { UsersModule } from '../users/users.module';
import { InitDataGuard } from './init-data.guard';
import { MeController } from './me.controller';
import { ModeratorGuard } from './moderator.guard';
import { UserThrottlerGuard } from './user-throttler.guard';

/**
 * Проверка initData и роли модератора. Nest собирает @UseGuards(InitDataGuard) в модуле контроллера,
 * поэтому UsersModule и SupportModule реэкспортируются: импортировать AuthModule — достаточно.
 */
@Module({
  imports: [UsersModule, SupportModule],
  controllers: [MeController],
  providers: [InitDataGuard, ModeratorGuard, UserThrottlerGuard],
  exports: [
    UsersModule,
    SupportModule,
    InitDataGuard,
    ModeratorGuard,
    UserThrottlerGuard,
  ],
})
export class AuthModule {}
