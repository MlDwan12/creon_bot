import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalanceController } from './balance.controller';
import { PayoutsService } from './payouts.service';
import { RateController } from './rate.controller';
import { UsdtRateService } from './usdt-rate.service';

@Module({
  imports: [AuthModule],
  controllers: [BalanceController, RateController],
  providers: [PayoutsService, UsdtRateService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
