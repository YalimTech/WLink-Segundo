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
      if (!instance || instance.userId !== locationId) {
        throw new UnauthorizedException(
          'Instancia no encontrada o no estás autorizado para acceder a ella',
        );
      }

      // ✅ Actualiza el estado a 'qr_code' en la base de datos, lo cual es clave.
      // Usar instance.idInstance (el ID único de Evolution API) para actualizar el estado.
      await this.prisma.updateInstanceState(instance.idInstance, 'qr_code');
      this.logger.log(`Estado de la instancia actualizado a 'qr_code' para: ${instance.idInstance}`); // Usar instance.idInstance en el log

      // ✅ Pasa el 'idInstance' de la instancia a la API de Evolution.
      // La API de Evolution espera el identificador único de la instancia, que es 'idInstance'.
      const qrData = await this.evolutionService.getQrCode(
        instance.apiTokenInstance,
        instance.idInstance, // CORRECTO: La API de Evolution usa el idInstance único.
      );

      // ✅ Maneja respuestas inesperadas de la API.
      if (!qrData || !qrData.type || !qrData.data) {
        this.logger.error(
          `Respuesta inesperada de la API de Evolution para la instancia "${instance.idInstance}": ${JSON.stringify(qrData)}` // Usar instance.idInstance en el log
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
        `Error al obtener el QR para la instancia con ID "${id}" (Evolution API ID: ${err.instanceId || 'N/A'}): ${err.message}`,
        err.stack,
      );
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException('Error al obtener el código QR de la API de Evolution');
    }
  }
}
