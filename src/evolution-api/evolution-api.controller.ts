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
            instance.idInstance,
          );
          const state = status?.state ?? status?.status;
          if (state && state !== instance.state) {
            await this.prisma.updateInstanceState(
              instance.idInstance,
              state as any,
            );
            instance.state = state as any;
          }
        } catch (err) {
          this.logger.warn(`Failed to refresh state for ${instance.idInstance}`);
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
   * ✅ CORRECCIÓN: Ahora usa el ID numérico de la base de datos.
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
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Failed to logout ${inst.name}: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to logout instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Borra una instancia permanentemente, tanto de Evolution API como de la base de datos local.
   * ✅ CORRECCIÓN: Ahora usa el ID numérico de la base de datos.
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
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.idInstance,
      );
      this.logger.log(`Instance ${instanceData.name} deleted from Evolution API.`);
    } catch (error) {
      this.logger.warn(`Could not delete ${instanceData.name} from Evolution. It might already be gone. Continuing...`);
    }

    // Nota: Asegúrate de tener el método 'removeInstanceById' en tu prisma.service.ts
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

