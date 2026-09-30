import { Module } from '@nestjs/common';
import { BansService } from './bans.service';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, BansService],
  exports: [UsersService, BansService],
})
export class UsersModule {}
