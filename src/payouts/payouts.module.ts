import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalanceController } from './balance.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule],
  controllers: [BalanceController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
