import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsArray,
  ValidateIf,
  ArrayNotEmpty,
} from 'class-validator';

export class GhlExternalAuthPayloadDto {
  // locationId puede venir como string o array
  @ValidateIf((_, value) => value !== undefined)
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  locationId?: string[];  // Se procesará como array, y luego tú tomas el primero manualmente

  @ValidateIf((_, value) => value !== undefined)
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\-]+$/, {
    message: 'instance_id must contain only letters, numbers, or dashes',
  })
  instance_id?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\-]+$/, {
    message: 'api_token_instance must contain only letters, numbers, or dashes',
  })
  api_token_instance?: string;
}

