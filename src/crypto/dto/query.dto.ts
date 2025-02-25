import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for crypto query requests
 */
export class CryptoQueryDto {
  @IsString()
  @IsNotEmpty()
  readonly question!: string;
}
