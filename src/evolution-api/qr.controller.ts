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
    @Param('id') id: string, // Este 'id' es el ID numérico de la DB (BigInt)
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;
    this.logger.log(`Solicitud de QR para la instancia con ID numérico: ${id} desde la ubicación: ${locationId}`);

    try {
      // ✅ Convierte correctamente el 'id' (string) a 'BigInt' para la consulta.
      const instanceId = BigInt(id);
      const instance = await this.prisma.getInstanceById(instanceId);

      // ✅ Valida la autorización correctamente.
      // CAMBIO: Usar instance.locationId
      if (!instance || instance.locationId !== locationId) {
        throw new UnauthorizedException(
          'Instancia no encontrada o no estás autorizado para acceder a ella',
        );
      }

      // ✅ Actualiza el estado a 'qr_code' en la base de datos, lo cual es clave.
      // Usar instance.instanceName (el ID único de Evolution API) para actualizar el estado.
      await this.prisma.updateInstanceState(instance.instanceName, 'qr_code'); // CAMBIO: Usar instance.instanceName
      this.logger.log(`Estado de la instancia actualizado a 'qr_code' para: ${instance.instanceName}`); // CAMBIO: Usar instance.instanceName en el log

      // ✅ Pasa el 'instanceName' de la instancia a la API de Evolution.
      // La API de Evolution espera el identificador único de la instancia, que es 'instanceName'.
      const qrData = await this.evolutionService.getQrCode(
        instance.apiTokenInstance,
        instance.instanceName, // CAMBIO: Usar instance.instanceName
      );

      // ✅ Maneja respuestas inesperadas de la API.
      if (!qrData || !qrData.type || !qrData.data) {
        this.logger.error(
          `Respuesta inesperada de la API de Evolution para la instancia "${instance.instanceName}": ${JSON.stringify(qrData)}` // CAMBIO: Usar instance.instanceName en el log
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
        `Error al obtener el QR para la instancia con ID "${id}" (Evolution API ID: ${err.instanceId || 'N/A'}): ${err.message}`, // `err.instanceId` se mantiene si es una propiedad del error
        err.stack,
      );
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('Error al obtener el código QR de la API de Evolution');
    }
  }
}
