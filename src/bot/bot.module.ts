import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { currentUserMiddleware } from './middlewares/current-user.middleware';
import { ignoreNotModifiedMiddleware } from './middlewares/ignore-not-modified.middleware';
import { AdvertiserRejectWizard } from './scenes/advertiser-reject.scene';
import { CreateOrderScene } from './scenes/create-order.scene';
import { ModeratorRejectWizard } from './scenes/moderator-reject.scene';
import { OrderRejectWizard } from './scenes/order-reject.scene';
import { SubmitVideoScene } from './scenes/submit-video.scene';
import { BrowseUpdate } from './updates/browse.update';
import { ModerationUpdate } from './updates/moderation.update';
import { MyOrdersUpdate } from './updates/my-orders.update';
import { MySubmissionsUpdate } from './updates/my-submissions.update';
import { StartUpdate } from './updates/start.update';
import { OrdersModule } from '../orders/orders.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';

@Module({
  imports: [
    UsersModule,
    OrdersModule,
    SubmissionsModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule, UsersModule],
      inject: [ConfigService, UsersService],
      useFactory: (config: ConfigService, usersService: UsersService) => ({
        token: config.get<string>('BOT_TOKEN')!,
        middlewares: [
          session(),
          ignoreNotModifiedMiddleware(),
          currentUserMiddleware(usersService),
        ],
      }),
    }),
  ],
  providers: [
    StartUpdate,
    BrowseUpdate,
    MyOrdersUpdate,
    MySubmissionsUpdate,
    ModerationUpdate,
    CreateOrderScene,
    SubmitVideoScene,
    ModeratorRejectWizard,
    AdvertiserRejectWizard,
    OrderRejectWizard,
  ],
})
export class BotModule {}
