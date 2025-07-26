//src/evolution-api/qr.controller.ts
import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
  Logger,
  UnauthorizedException,
  Req,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../evolution/evolution.service';
import { GhlContextGuard } from './guards/ghl-context.guard';
import { AuthReq } from '../types';

@Controller('api/qr')
@UseGuards(GhlContextGuard)
export class QrController {
  constructor(
    private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly evolutionService: EvolutionService,
  ) {}

  // ✅ El parámetro de la ruta 'id' es correcto.
  @Get(':id')
  async getQrCode(
    @Param('id') id: string,
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;
    this.logger.log(`QR request for instance numeric ID: ${id} from location: ${locationId}`);

    try {
      // ✅ Convierte correctamente el 'id' (string) a 'BigInt' para la consulta.
      const instanceId = BigInt(id);
      const instance = await this.prisma.getInstanceById(instanceId);

      // ✅ Valida la autorización correctamente.
      if (!instance || instance.userId !== locationId) {
        throw new UnauthorizedException(
          'Instance not found or you are not authorized to access it',
        );
      }

      // ✅ Actualiza el estado a 'qr_code' en la base de datos, lo cual es clave.
      await this.prisma.updateInstanceState(instance.idInstance, 'qr_code');
      this.logger.log(`Instance state updated to 'qr_code' for: ${instance.name}`);

      // ✅ Pasa el 'name' de la instancia a la API de Evolution, lo cual es correcto.
      const qrData = await this.evolutionService.getQrCode(
        instance.apiTokenInstance,
        instance.name, // La API de Evolution usa el nombre legible.
      );

      // ✅ Maneja respuestas inesperadas de la API.
      if (!qrData || !qrData.type || !qrData.data) {
        this.logger.error(
          `Unexpected response from Evolution API for instance "${instance.name}": ${JSON.stringify(qrData)}`
        );
        throw new HttpException(
          'Unexpected response from QR service',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return qrData;
    } catch (err: any) {
      // ✅ Manejo de errores robusto.
      this.logger.error(
        `Failed to get QR for instance ID "${id}": ${err.message}`,
        err.stack,
      );
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('Failed to fetch QR code from Evolution API');
    }
  }
}


