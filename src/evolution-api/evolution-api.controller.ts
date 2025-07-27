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
          const status = await this.evolutionService.getInstanceStatus(
            instance.apiTokenInstance,
            instance.idInstance, // idInstance es el "name" de Evolution API
          );
          // La Evolution API puede devolver 'state' o 'status' para el estado
          const state = status?.state ?? status?.status;

          this.logger.log(`[getInstances] Fetched state for instance '${instance.idInstance}' (DB ID: ${instance.id}): ${state}`); // CAMBIO: Usar idInstance en el log

          if (state && state !== instance.state) {
            // Si el estado ha cambiado, actualizarlo en la base de datos
            await this.prisma.updateInstanceState(
              instance.idInstance,
              state as any, // Castear a 'any' si hay un ligero desajuste de tipos
            );
            instance.state = state as any; // Actualizar el objeto en memoria para la respuesta
            this.logger.log(`[getInstances] DB updated for instance '${instance.idInstance}'. New state: ${state}`); // CAMBIO: Usar idInstance en el log
          }
        } catch (err) {
          this.logger.warn(`[getInstances] Failed to refresh state for instance '${instance.idInstance}' (DB ID: ${instance.id}): ${err.message}`); // CAMBIO: Usar idInstance en el log
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
        customName: instance.customName, // CAMBIO: 'name' a 'customName'
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
    if (!dto.instanceId || !dto.token || !dto.instanceName) { // dto.instanceName ahora es customName
      throw new HttpException('Instance ID, token and name are required.', HttpStatus.BAD_REQUEST);
    }
    try {
      const instance = await this.evolutionApiService.createEvolutionApiInstanceForUser(
        dto.locationId,
        dto.instanceId, // idInstance de Evolution API
        dto.token,
        dto.instanceName, // customName para la DB
      );
      return { success: true, instance };
    } catch (err: any) {
      this.logger.error(`Failed to create instance ${dto.instanceName}: ${err.message}`);
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
        inst.idInstance,
      );
      await this.prisma.updateInstanceState(inst.idInstance, 'notAuthorized'); 

      this.logger.log(`Instance ${inst.idInstance} (DB ID: ${inst.id}) logged out successfully.`); // CAMBIO: Usar idInstance en el log
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Failed to logout ${inst.idInstance} (DB ID: ${inst.id}): ${err.message}`); // CAMBIO: Usar idInstance en el log
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
    this.logger.log(`Attempting to delete instance DB ID: ${id} for location: ${locationId}`);
    
    const instanceId = BigInt(id);
    const instanceData = await this.prisma.getInstanceById(instanceId);

    if (!instanceData || instanceData.userId !== locationId) {
      throw new UnauthorizedException('Instance not found or not authorized for this location');
    }
    
    try {
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.idInstance,
      );
      this.logger.log(`Instance ${instanceData.idInstance} deleted from Evolution API.`); // CAMBIO: Usar idInstance en el log
    } catch (error) {
      this.logger.warn(`Could not delete ${instanceData.idInstance} from Evolution. It might already be gone. Continuing...`); // CAMBIO: Usar idInstance en el log
    }

    await this.prisma.removeInstanceById(instanceId);
    this.logger.log(`Instance DB ID ${id} deleted from local database.`);
    return {
      success: true,
      message: 'Instance deleted successfully',
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
      const updatedInstance = await this.prisma.updateInstanceCustomName(instanceData.idInstance, dto.customName); // CAMBIO: Llamar a updateInstanceCustomName
      this.logger.log(`Instance ${instanceData.idInstance} custom name updated to ${dto.customName}.`);
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


