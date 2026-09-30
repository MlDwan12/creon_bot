import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Переписка с поддержкой. AuthModule не импортирует — сам нужен ему (бан-уведомления в InitDataGuard). */
@Module({
  imports: [UsersModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
