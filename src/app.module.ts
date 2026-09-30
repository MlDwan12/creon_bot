import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { ModerationModule } from './moderation/moderation.module';
import { OrdersModule } from './orders/orders.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { ReportsModule } from './reports/reports.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SupportModule } from './support/support.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Общий лимит на пользователя; у создания заказа и отклика — свои, построже (@Throttle).
    // ponytail: счётчики в памяти процесса — пока инстанс один; станет несколько — хранилище в Redis.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      errorMessage:
        'Слишком много запросов — подождите минуту и попробуйте снова',
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    SupportModule,
    TelegramModule,
    OrdersModule,
    SubmissionsModule,
    ProfilesModule,
    ReportsModule,
    PayoutsModule,
    ModerationModule,
    JobsModule,
  ],
})
export class AppModule {}
