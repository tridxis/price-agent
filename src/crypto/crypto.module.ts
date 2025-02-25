import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { CryptoController } from './crypto.controller';
import { CryptoService } from './crypto.service';
import { PriceDataService } from './price-data.service';
import { CoinListService } from './coin-list.service';

@Module({
  imports: [HttpModule, ScheduleModule.forRoot()],
  controllers: [CryptoController],
  providers: [CryptoService, PriceDataService, CoinListService],
})
export class CryptoModule {}
