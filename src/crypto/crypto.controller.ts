import { Controller, Post, Body } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CryptoQueryDto } from './dto/query.dto';

@Controller('crypto')
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  @Post('ask')
  async askQuestion(
    @Body() queryDto: CryptoQueryDto,
  ): Promise<{ answer: string }> {
    const answer = await this.cryptoService.processQuestion(queryDto.question);
    return { answer };
  }
}
