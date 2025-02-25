import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as crypto from 'crypto';

// Polyfill for older Node.js versions
if (!global.crypto) {
  (global as any).crypto = crypto;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
