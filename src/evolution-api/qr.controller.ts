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

  // ✅ CORRECCIÓN: El parámetro de la ruta ahora es 'id' para coincidir con lo que envía el frontend.
  @Get(':id')
  async getQrCode(
    @Param('id') id: string,
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;
    this.logger.log(`QR request for instance numeric ID: ${id} from location: ${locationId}`);

    try {
      // El ID que llega del frontend es el numérico (BigInt).
      const instanceId = BigInt(id);
      const instance = await this.prisma.getInstanceById(instanceId);

      if (!instance || instance.userId !== locationId) {
        throw new UnauthorizedException(
          'Instance not found or you are not authorized to access it',
        );
      }

      // ✅ CORRECCIÓN CLAVE: Actualizar el estado a 'qr_code' en la base de datos.
      // Esto sucede ANTES de devolver el QR, para que la UI se actualice correctamente.
      await this.prisma.updateInstanceState(instance.idInstance, 'qr_code');
      this.logger.log(`Instance state updated to 'qr_code' for: ${instance.name}`);

      // ✅ CORRECCIÓN: Pasar el 'name' de la instancia, no el 'idInstance'.
      const qrData = await this.evolutionService.getQrCode(
        instance.apiTokenInstance,
        instance.name, // La API de Evolution usa el nombre legible.
      );

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
      this.logger.error(
        `Failed to get QR for instance ID "${id}": ${err.message}`,
        err.stack,
      );
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('Failed to fetch QR code from Evolution API');
    }
  }
}


