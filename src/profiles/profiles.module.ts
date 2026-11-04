import { Module } from '@nestjs/common';
import { AdvertisersModule } from '../advertisers/advertisers.module';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { LinkVerificationsService } from './link-verifications.service';

@Module({
  imports: [AuthModule, TelegramModule, AdvertisersModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, LinkVerificationsService],
  exports: [ProfilesService, LinkVerificationsService],
})
export class ProfilesModule {}
