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

  @Get(':instanceName')
  async getQrCode(
    @Param('instanceName') instanceName: string,
    @Req() req: AuthReq,
  ) {
    const { locationId } = req;

    try {
      const instance = await this.prisma.getInstance(instanceName);

      if (!instance || instance.userId !== locationId) {
        throw new UnauthorizedException(
          'Instance not found or you are not authorized to access it',
        );
      }

      const qrData = await this.evolutionService.getQrCode(
        instance.apiTokenInstance,
        instance.idInstance,
      );

      if (!qrData || typeof qrData !== 'object' || !qrData.type || !qrData.data) {
        this.logger.error(
          `Unexpected response from Evolution API for instance "${instance.idInstance}": ${JSON.stringify(qrData)}`
        );
        throw new HttpException(
          'Unexpected response from QR service',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        type: qrData.type,
        data: qrData.data,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to get QR for instance "${instanceName}": ${err.message}`,
        err.stack,
      );
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        'Failed to fetch QR code from Evolution API',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}



