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
  locationId?: string[]; // Se procesará como array, y luego tú tomas el primero manualmente

  // CAMBIO: Renombrado de 'instance_id' a 'instanceId' para concordancia
  @ValidateIf((_, value) => value !== undefined)
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\-]+$/, {
    message: 'instanceId must contain only letters, numbers, or dashes', // Actualizado el mensaje
  })
  instanceId?: string; // Renombrado

  @ValidateIf((_, value) => value !== undefined)
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\-]+$/, {
    message: 'api_token_instance must contain only letters, numbers, or dashes',
  })
  api_token_instance?: string;
}
