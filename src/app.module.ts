import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// import { CryptoModule } from './crypto/crypto.module';
import { HyperliquidModule } from './hyperliquid/hyperliquid.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // CryptoModule,
    HyperliquidModule,
  ],
})
export class AppModule {}
