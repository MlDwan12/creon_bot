import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { BotUpdate } from './bot.update';
import { currentUserMiddleware } from './middlewares/current-user.middleware';
import { AdvertiserRejectWizard } from './scenes/advertiser-reject.scene';
import { CreateOrderScene } from './scenes/create-order.scene';
import { ModeratorRejectWizard } from './scenes/moderator-reject.scene';
import { OrderRejectWizard } from './scenes/order-reject.scene';
import { SubmitVideoScene } from './scenes/submit-video.scene';
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
        middlewares: [session(), currentUserMiddleware(usersService)],
      }),
    }),
  ],
  providers: [
    BotUpdate,
    CreateOrderScene,
    SubmitVideoScene,
    ModeratorRejectWizard,
    AdvertiserRejectWizard,
    OrderRejectWizard,
  ],
})
export class BotModule {}
