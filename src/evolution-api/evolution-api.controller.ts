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
        id: instance.idInstance,
        name: instance.name,
        state: instance.state,
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
   * Obtiene un nuevo código QR para una instancia desconectada.
   */

  
 @Get('qr/:instance')
async getQrCode(@Param('instance') instance: string, @Req() req: AuthReq) {
  const { locationId } = req;
  const inst = await this.prisma.getInstance(instance);
  if (!inst || inst.userId !== locationId) {
    throw new HttpException('Instance not found or not authorized', HttpStatus.FORBIDDEN);
  }
  try {
    const qr = await this.evolutionService.getQrCode(inst.apiTokenInstance, instance);
    return {
      success: true,
      type: qr.type,  // 'qr' o 'code'
      data: qr.data,  // base64 o string
    };
  } catch (err: any) {
    this.logger.error(`Failed to get QR for ${instance}: ${err.message}`);
    if (err instanceof HttpException) throw err;
    throw new HttpException('Failed to fetch QR code', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}


  /**
   * Desconecta una instancia de WhatsApp sin borrarla.
   */
  @Delete(':instance/logout')
  async logoutInstance(@Param('instance') instance: string, @Req() req: AuthReq) {
    const { locationId } = req;
    const inst = await this.prisma.getInstance(instance);
    if (!inst || inst.userId !== locationId) {
      throw new HttpException('Instance not found or not authorized', HttpStatus.FORBIDDEN);
    }
    try {
      await this.evolutionService.logoutInstance(
        inst.apiTokenInstance,
        inst.idInstance,
      );
      return { success: true, message: 'Logout command sent successfully.' };
    } catch (err: any) {
      this.logger.error(`Failed to logout ${instance}: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException('Failed to logout instance', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Borra una instancia permanentemente, tanto de Evolution API como de la base de datos local.
   */
  @Delete(':instance')
  async deleteInstance(@Param('instance') instance: string, @Req() req: AuthReq) {
    const { locationId } = req;
    this.logger.log(`Attempting to delete instance: ${instance} for location: ${locationId}`);
    const instanceData = await this.prisma.getInstance(instance);
    if (!instanceData || instanceData.userId !== locationId) {
      throw new HttpException('Instance not found or not authorized for this location', HttpStatus.FORBIDDEN);
    }
    
    // 1. Borrar de Evolution API
    try {
      await this.evolutionService.deleteInstance(
        instanceData.apiTokenInstance,
        instanceData.idInstance,
      );
      this.logger.log(`Instance ${instance} deleted from Evolution API.`);
    } catch (error) {
      this.logger.warn(`Could not delete ${instance} from Evolution. It might already be gone. Continuing...`);
    }

    // 2. Borrar de la base de datos local
    await this.prisma.removeInstance(instance);
    this.logger.log(`Instance ${instance} deleted from local database.`);
    return {
      success: true,
      message: 'Instance deleted successfully',
    };
  }

  /**
   * Actualiza el nombre (nickname) de una instancia.
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



