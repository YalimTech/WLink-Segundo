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
  ) {}

  /**
   * Obtiene todas las instancias asociadas a una ubicación de GHL.
   * También refresca el estado de las instancias consultando la Evolution API.
   * ✅ MEJORA: Más logs para depurar el estado de la instancia.
   */
  @Get()
  async getInstances(@Req() req: AuthReq) {
    const { locationId } = req;
    const instances = await this.prisma.getInstancesByUserId(locationId);

    const refreshed = await Promise.all(
      instances.map(async (instance) => {
        try {
          // Usa instance.idInstance cuando llames a EvolutionService, ya que es el identificador único de Evolution API
          const status = await this.evolutionService.getInstanceStatus(
            instance.apiTokenInstance,
            instance.idInstance, // Correcto: idInstance es el "name" de Evolution API
          );
          // La Evolution API puede devolver 'state' o 'status' para el estado
          const state = status?.state ?? status?.status;

          this.logger.log(`[getInstances] Estado obtenido para la instancia '${instance.idInstance}' (ID de BD: ${instance.id}): ${state}`); // Usar idInstance en el log

          if (state && state !== instance.state) {
            // Si el estado ha cambiado, actualizarlo en la base de datos
            // updateInstanceState en PrismaService espera idInstance como primer parámetro
            const updatedInstance = await this.prisma.updateInstanceState(
              instance.idInstance,
              state as any, // Castear a 'any' si hay un ligero desajuste de tipos
            );
            // Actualizar el objeto en memoria para la respuesta solo si la actualización fue exitosa
            if (updatedInstance) {
              instance.state = updatedInstance.state;
              this.logger.log(`[getInstances] BD actualizada para la instancia '${instance.idInstance}'. Nuevo estado: ${state}`); // Usar idInstance en el log
            } else {
              this.logger.warn(`[getInstances] No se pudo actualizar el estado de la instancia '${instance.idInstance}' en la BD, a pesar de que la API de Evolution devolvió un nuevo estado.`);
            }
          }
        } catch (err: any) {
          this.logger.warn(`[getInstances] Error al actualizar el estado de la instancia '${instance.idInstance}' (ID de BD: ${instance.id}): ${err.message}`); // Usar idInstance en el log
          // Opcional: Podrías establecer un estado de error si la instancia no responde
          // await this.prisma.updateInstanceState(instance.idInstance, 'error');
        }
        return instance;
      }),
    );

    return {
      success: true,
      instances: refreshed.map((instance) => ({
        id: instance.id,
        idInstance: instance.idInstance, // Añadir idInstance a la respuesta del frontend
        customName: instance.customName, // Correcto: 'customName'
        state: instance.state,
        guid: instance.instanceGuid,
        createdAt: instance.createdAt, // Asegurarse de enviar la fecha de creación
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
    if (!dto.evolutionApiInstanceId || !dto.apiToken) { // customName es opcional
      throw new HttpException('Evolution API Instance ID and API Token are required.', HttpStatus.BAD_REQUEST);
    }
    try {
      const instance = await this.evolutionApiService.createEvolutionApiInstanceForUser(
        dto.locationId,
        dto.evolutionApiInstanceId, // Pasar el ID único de Evolution API
        dto.apiToken,               // Pasar el Token de API
        dto.customName,             // Pasar el customName (puede ser undefined si es opcional)
      );
      return { success: true, instance };
    } catch (err: any) {
      this.logger.error(`Failed to create instance ${dto.evolutionApiInstanceId} (Custom Name: ${dto.customName}): ${err.message}`);
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

    if (!inst || inst.userId !== locationId) {
      throw new UnauthorizedException('Instance not found or not authorized');
    }
    try {
      await this.evolutionService.logoutInstance(
        inst.apiTokenInstance,
        inst.idInstance, // Correcto: Usar idInstance de Evolution API
      );
      await this.prisma.updateInstanceState(inst.idInstance, 'notAuthorized');

      this.logger.log(`Instancia ${inst.idInstance} (ID de BD: ${inst.id}) desconectada exitosamente.`); // Usar idInstance en el log
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Error al desconectar ${inst.idInstance} (ID de BD: ${inst.id}): ${err.message}`); // Usar idInstance en el log
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

    if (!instanceData || instanceData.userId !== locationId) {
      throw new UnauthorizedException('Instancia no encontrada o no autorizada para esta ubicación');
    }

    try {
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.idInstance, // Correcto: Usar idInstance de Evolution API
      );
      this.logger.log(`Instancia ${instanceData.idInstance} eliminada de la API de Evolution.`); // Usar idInstance en el log
    } catch (error) {
      this.logger.warn(`No se pudo eliminar ${instanceData.idInstance} de Evolution. Podría ya no existir. Continuando...`); // Usar idInstance en el log
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
   * ✅ CAMBIO: Busca por el ID numérico de la DB, no por el idInstance de Evolution API.
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

    if (!instanceData || instanceData.userId !== locationId) {
      throw new HttpException('Instance not found or not authorized for this location', HttpStatus.FORBIDDEN);
    }
    try {
      // Usar el idInstance de Evolution API para la actualización en Prisma
      const updatedInstance = await this.prisma.updateInstanceCustomName(instanceData.idInstance, dto.customName); // Correcto: Llamar a updateInstanceCustomName
      this.logger.log(`Nombre personalizado de la instancia ${instanceData.idInstance} actualizado a ${dto.customName}.`);
      return {
        success: true,
        instance: updatedInstance,
      };
    } catch (err: any) {
      this.logger.error(`Failed to update custom name for instance ${instanceData.idInstance}: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to update instance custom name', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
