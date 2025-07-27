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
import { AuthReq, CreateInstanceDto, UpdateInstanceDto } from '../types';
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

          this.logger.log(`[getInstances] Fetched state for instance '${instance.name}' (Evolution ID: ${instance.idInstance}): ${state}`);

          if (state && state !== instance.state) {
            // Si el estado ha cambiado, actualizarlo en la base de datos
            await this.prisma.updateInstanceState(
              instance.idInstance,
              state as any, // Castear a 'any' si hay un ligero desajuste de tipos
            );
            instance.state = state as any; // Actualizar el objeto en memoria para la respuesta
            this.logger.log(`[getInstances] DB updated for instance '${instance.name}'. New state: ${state}`);
          }
        } catch (err) {
          this.logger.warn(`[getInstances] Failed to refresh state for instance '${instance.name}' (ID: ${instance.idInstance}): ${err.message}`);
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
        name: instance.name,
        state: instance.state,
        guid: instance.instanceGuid,
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
    if (!dto.instanceId || !dto.token || !dto.instanceName) {
      throw new HttpException('Instance ID, token and name are required.', HttpStatus.BAD_REQUEST);
    }
    try {
      const instance = await this.evolutionApiService.createEvolutionApiInstanceForUser(
        dto.locationId,
        dto.instanceId,
        dto.token,
        dto.instanceName,
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
   * Esto hace que la sesión de WhatsApp se cierre y requiera un nuevo escaneo de QR.
   * ✅ IMPORTANTE: Se ha añadido la actualización del estado en la DB a 'notAuthorized'.
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
      // Llama al servicio de Evolution para desconectar la instancia
      await this.evolutionService.logoutInstance(
        inst.apiTokenInstance,
        inst.idInstance,
      );
      
      // Actualiza el estado de la instancia en tu base de datos a 'notAuthorized'
      // Esto es crucial para que la UI refleje inmediatamente que la sesión está cerrada.
      // La Evolution API también debería enviar un webhook de `connection.update` que lo haría,
      // pero esta actualización directa asegura una mayor reactividad.
      await this.prisma.updateInstanceState(inst.idInstance, 'notAuthorized'); 

      this.logger.log(`Instance ${inst.name} (ID: ${inst.idInstance}) logged out successfully.`);
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Failed to logout ${inst.name} (ID: ${inst.idInstance}): ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to logout instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Borra una instancia permanentemente, tanto de Evolution API como de la base de datos local.
   * Se asegura de que la instancia pertenezca al usuario autenticado.
   */
  @Delete(':id')
  async deleteInstance(@Param('id') id: string, @Req() req: AuthReq) {
    const { locationId } = req;
    this.logger.log(`Attempting to delete instance ID: ${id} for location: ${locationId}`);
    
    const instanceId = BigInt(id);
    const instanceData = await this.prisma.getInstanceById(instanceId);

    if (!instanceData || instanceData.userId !== locationId) {
      throw new UnauthorizedException('Instance not found or not authorized for this location');
    }
    
    try {
      // Intenta borrar la instancia de la Evolution API
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.idInstance,
      );
      this.logger.log(`Instance ${instanceData.name} deleted from Evolution API.`);
    } catch (error) {
      // Si falla, solo lo loguea y continúa, ya que la instancia podría no existir en Evolution API
      this.logger.warn(`Could not delete ${instanceData.name} from Evolution. It might already be gone. Continuing...`);
    }

    // Finalmente, borra la instancia de la base de datos local
    await this.prisma.removeInstanceById(instanceId);
    this.logger.log(`Instance ID ${id} deleted from local database.`);
    return {
      success: true,
      message: 'Instance deleted successfully',
    };
  }

  /**
   * Actualiza el nombre (nickname) de una instancia.
   * Nota: Este método también necesitaría ser ajustado si se usa desde el frontend.
   */
  @Patch(':instance')
  async updateInstance(
    @Param('instance') instance: string,
    @Body() dto: UpdateInstanceDto,
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;
    // Asumiendo que getInstance puede buscar por instanceGuid o idInstance string
    const instanceData = await this.prisma.getInstance(instance); 
    if (!instanceData || instanceData.userId !== locationId) {
      throw new HttpException('Instance not found or not authorized for this location', HttpStatus.FORBIDDEN);
    }
    try {
      const updatedInstance = await this.prisma.updateInstanceName(instance, dto.name);
      return {
        success: true,
        instance: updatedInstance,
      };
    } catch (err: any) {
      this.logger.error(`Failed to update instance ${instance}: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to update instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}


