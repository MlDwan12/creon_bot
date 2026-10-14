import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import {
  AccountsController,
  OAuthCallbackController,
} from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [AccountsController, OAuthCallbackController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
