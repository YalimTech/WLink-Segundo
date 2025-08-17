// src/evolution-api/evolution-api.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Req,
  UseGuards,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EvolutionService } from '../evolution/evolution.service';
import { EvolutionApiService } from './evolution-api.service';
import { AuthReq, CreateInstanceDto, UpdateInstanceDto } from '../types'; // Importa UpdateInstanceDto
import { GhlContextGuard } from './guards/ghl-context.guard';

@Controller('api/instances')
@UseGuards(GhlContextGuard)
export class EvolutionApiController {
  constructor(
    private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly evolutionService: EvolutionService,
    private readonly evolutionApiService: EvolutionApiService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Obtiene todas las instancias asociadas a una ubicación de GHL.
   * También refresca el estado de las instancias consultando la Evolution API.
   * ✅ MEJORA: Más logs para depurar el estado de la instancia.
   */
  @Get()
  async getInstances(@Req() req: AuthReq) {
    const { locationId } = req;
    // CAMBIO: Usar getInstancesByLocationId
    const instances = await this.prisma.getInstancesByLocationId(locationId);

    const refreshed = await Promise.all(
      instances.map(async (instance) => {
        try {
          // Usa instance.instanceName cuando llames a EvolutionService, ya que es el identificador único de Evolution API
          const status = await this.evolutionService.getInstanceStatus(
            instance.apiTokenInstance,
            instance.instanceName, // CAMBIO: Usar instance.instanceName
          );
          // Evolution API v2 devuelve el estado bajo `instance.state` (fallbacks conservados)
          const rawState =
            status?.instance?.state ?? status?.state ?? status?.status;

          // Mapea el estado crudo de Evolution v2 a nuestros enums de `InstanceState`
          const state =
            rawState === 'open'
              ? 'authorized'
              : rawState === 'connecting'
              ? 'starting'
              : rawState === 'qrcode'
              ? 'qr_code'
              : rawState === 'close'
              ? 'notAuthorized'
              : undefined;

          this.logger.log(`[getInstances] Estado obtenido para la instancia '${instance.instanceName}' (ID de BD: ${instance.id}): ${state}`); // CAMBIO: Usar instance.instanceName en el log

          if (state && state !== instance.state) {
            // Si el estado ha cambiado, actualizarlo en la base de datos
            // updateInstanceState en PrismaService espera instanceName como primer parámetro
            const updatedInstance = await this.prisma.updateInstanceState(
              instance.instanceName, // CAMBIO: Usar instance.instanceName
              state as any, // Castear a 'any' si hay un ligero desajuste de tipos
            );
            // Actualizar el objeto en memoria para la respuesta solo si la actualización fue exitosa
            if (updatedInstance) {
              instance.state = updatedInstance.state;
              this.logger.log(`[getInstances] BD actualizada para la instancia '${instance.instanceName}'. Nuevo estado: ${state}`); // CAMBIO: Usar instance.instanceName en el log
            } else {
              this.logger.warn(`[getInstances] No se pudo actualizar el estado de la instancia '${instance.instanceName}' en la BD, a pesar de que la API de Evolution devolvió un nuevo estado.`);
            }
          }

          // Asegurar que el webhook de Evolution v2 esté configurado (idempotente)
          try {
            const appUrl = this.configService.get<string>('APP_URL');
            if (appUrl) {
              const expectedUrl = `${appUrl.replace(/\/$/, '')}/webhooks/evolution`;
              const current = await this.evolutionService.findWebhook(
                instance.apiTokenInstance,
                instance.instanceName,
              );
              const currentUrl: string | undefined = current?.webhook?.url || current?.url;
              if (!currentUrl || currentUrl !== expectedUrl) {
                await this.evolutionService.setWebhook(
                  instance.apiTokenInstance,
                  instance.instanceName,
                  {
                    webhook: {
                      url: expectedUrl,
                      headers: { Authorization: `Bearer ${instance.apiTokenInstance}` },
                      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
                      enabled: true,
                    },
                  },
                );
                this.logger.log(`[getInstances] Webhook ensured for instance '${instance.instanceName}' -> ${expectedUrl}`);
              }
            }
          } catch (whErr: any) {
            this.logger.warn(`[getInstances] Could not ensure webhook for instance '${instance.instanceName}': ${whErr.message}`);
          }
        } catch (err: any) {
          this.logger.warn(`[getInstances] Error al actualizar el estado de la instancia '${instance.instanceName}' (ID de BD: ${instance.id}): ${err.message}`); // CAMBIO: Usar instance.instanceName en el log
          // Opcional: Podrías establecer un estado de error si la instancia no responde
          // await this.prisma.updateInstanceState(instance.instanceName, 'error');
        }
        return instance;
      }),
    );

    return {
      success: true,
      instances: refreshed.map((instance) => ({
        id: instance.id,
        instanceName: instance.instanceName, // CAMBIO: Añadir instanceName a la respuesta del frontend
        instanceId: instance.instanceId, // CAMBIO: Añadir instanceId a la respuesta del frontend
        customName: instance.customName, 
        state: instance.state,
        createdAt: instance.createdAt, 
      })),
    };
  }

  /**
   * Agrega una nueva instancia (creada manualmente) al sistema.
   */
  @Post()
  async createInstance(@Req() req: AuthReq, @Body() dto: CreateInstanceDto) {
    const { locationId } = req;
    if (locationId !== dto.locationId) {
      throw new HttpException('Context and payload locationId mismatch.', HttpStatus.FORBIDDEN);
    }
    // Validar los campos del DTO según la nueva nomenclatura
    // CAMBIO: Usar dto.instanceName en lugar de dto.evolutionApiInstanceId
    if (!dto.instanceName || !dto.token || !dto.instanceId) {
      throw new HttpException('Evolution API Instance ID (GUID), Instance Name and API Token are required.', HttpStatus.BAD_REQUEST);
    }
    try {
      // CAMBIO: Usar los nuevos nombres de parámetros
      const instance = await this.evolutionApiService.createEvolutionApiInstanceForUser(
        dto.locationId,
        dto.instanceName, // Pasar el Evolution API Instance Name
        dto.token,        // Pasar el Token de API
        dto.customName,   // Pasar el customName (puede ser undefined si es opcional)
        dto.instanceId,   // NUEVO: persistir el GUID si el cliente lo envía
      );
      return { success: true, instance };
    } catch (err: any) {
      this.logger.error(`Failed to create instance ${dto.instanceName} (Custom Name: ${dto.customName}): ${err.message}`); // CAMBIO: Logs
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to create instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Desconecta una instancia de WhatsApp sin borrarla.
   */
  @Delete(':id/logout')
  async logoutInstance(@Param('id') id: string, @Req() req: AuthReq) {
    const { locationId } = req;
    const instanceId = BigInt(id);
    const inst = await this.prisma.getInstanceById(instanceId);

    // CAMBIO: Usar inst.locationId
    if (!inst || inst.locationId !== locationId) {
      throw new UnauthorizedException('Instance not found or not authorized');
    }
    try {
      await this.evolutionService.logoutInstance(
        inst.apiTokenInstance,
        inst.instanceName, // CAMBIO: Usar inst.instanceName
      );
      await this.prisma.updateInstanceState(inst.instanceName, 'notAuthorized'); // CAMBIO: Usar inst.instanceName

      this.logger.log(`Instancia ${inst.instanceName} (ID de BD: ${inst.id}) desconectada exitosamente.`); // CAMBIO: Usar instanceName en el log
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Error al desconectar ${inst.instanceName} (ID de BD: ${inst.id}): ${err.message}`); // CAMBIO: Usar instanceName en el log
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to logout instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Borra una instancia permanentemente.
   */
  @Delete(':id')
  async deleteInstance(@Param('id') id: string, @Req() req: AuthReq) {
    const { locationId } = req;
    this.logger.log(`Intentando eliminar la instancia con ID de BD: ${id} para la ubicación: ${locationId}`);

    const instanceId = BigInt(id);
    const instanceData = await this.prisma.getInstanceById(instanceId);

    // CAMBIO: Usar instanceData.locationId
    if (!instanceData || instanceData.locationId !== locationId) {
      throw new UnauthorizedException('Instancia no encontrada o no autorizada para esta ubicación');
    }

    try {
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.instanceName, // CAMBIO: Usar instanceData.instanceName
      );
      this.logger.log(`Instancia ${instanceData.instanceName} eliminada de la API de Evolution.`); // CAMBIO: Usar instanceName en el log
    } catch (error) {
      this.logger.warn(`No se pudo eliminar ${instanceData.instanceName} de Evolution. Podría ya no existir. Continuando...`); // CAMBIO: Usar instanceName en el log
    }

    await this.prisma.removeInstanceById(instanceId);
    this.logger.log(`Instancia con ID de BD ${id} eliminada de la base de datos local.`);
    return {
      success: true,
      message: 'Instancia eliminada exitosamente',
    };
  }

  /**
   * Actualiza el nombre personalizado (customName) de una instancia.
   * ✅ CAMBIO: Ahora espera 'customName' en el DTO.
   * ✅ CAMBIO: Busca por el ID numérico de la DB, no por el instanceName de Evolution API.
   */
  @Patch(':id') // Usamos el ID numérico de la DB en la URL
  async updateInstance(
    @Param('id') id: string, // ID numérico de la DB
    @Body() dto: UpdateInstanceDto, // DTO ahora tiene 'customName'
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;
    const instanceId = BigInt(id);
    const instanceData = await this.prisma.getInstanceById(instanceId); // Buscar por ID numérico

    // CAMBIO: Usar instanceData.locationId
    if (!instanceData || instanceData.locationId !== locationId) {
      throw new HttpException('Instance not found or not authorized for this location', HttpStatus.FORBIDDEN);
    }
    try {
      // Usar el instanceName de Evolution API para la actualización en Prisma
      const updatedInstance = await this.prisma.updateInstanceCustomName(instanceData.instanceName, dto.customName); // CAMBIO: Llamar a updateInstanceCustomName con instanceName
      this.logger.log(`Nombre personalizado de la instancia ${instanceData.instanceName} actualizado a ${dto.customName}.`); // CAMBIO: Usar instanceName
      return {
        success: true,
        instance: updatedInstance,
      };
    } catch (err: any) {
      this.logger.error(`Failed to update custom name for instance ${instanceData.instanceName}: ${err.message}`); // CAMBIO: Usar instanceName
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to update instance custom name', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
