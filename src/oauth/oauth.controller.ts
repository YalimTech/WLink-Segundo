//src/oauth/oauth.controller.ts
import {
  Controller,
  Get,
  Query,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { GhlOAuthCallbackDto } from './dto/ghl-oauth-callback.dto';
import { EvolutionApiService } from '../evolution-api/evolution-api.service';

@Controller('oauth')
export class GhlOauthController {
  private readonly ghlServicesUrl = 'https://services.leadconnectorhq.com';

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly evolutionApiService: EvolutionApiService,
  ) {}

  @Get('callback')
  async callback(
    @Query()
    query: GhlOAuthCallbackDto & {
      instanceName?: string; // CAMBIO: Renombrado de 'evolutionApiInstanceId' a 'instanceName'
      token?: string; // Mantenido como 'token'
      customName?: string; // Mantenido como 'customName'
    },
    @Res() res: Response,
  ) {
    // Usar los nuevos nombres para desestructurar la consulta
    const { code, instanceName, token, customName } = query;
    this.logger.log(`GHL OAuth callback recibido. Code: ${code ? 'present' : 'MISSING'}`);

    if (!code) {
      this.logger.error('GHL OAuth callback missing code.');
      throw new HttpException(
        'Invalid OAuth callback from GHL (missing code).',
        HttpStatus.BAD_REQUEST,
      );
    }

    const clientId = this.configService.get<string>('GHL_CLIENT_ID')!;
    const clientSecret = this.configService.get<string>('GHL_CLIENT_SECRET')!;
    const appUrl = this.configService.get<string>('APP_URL')!;

    const tokenRequestBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: `${appUrl}/oauth/callback`,
      user_type: 'Location',
    });

    try {
      const tokenResponse = await axios.post(
        `${this.ghlServicesUrl}/oauth/token`,
        tokenRequestBody.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const {
        access_token,
        refresh_token,
        expires_in,
        scope,
        companyId: respCompanyId,
        locationId: respLocationId,
      } = tokenResponse.data;

      if (!respLocationId) {
        this.logger.error('GHL Token response did not include locationId!', tokenResponse.data);
        throw new HttpException(
          'Failed to get Location ID from GHL token response.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

      // CAMBIO: Usar 'locationId' en lugar de 'id' al crear el usuario
      await this.prisma.createUser({
        locationId: respLocationId, // CAMBIO: 'id' a 'locationId'
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt,
        companyId: respCompanyId,
      });

      this.logger.log(`Stored/updated GHL tokens for Location: ${respLocationId}`);

      // Usar los nuevos nombres de los parámetros y asegurar 'locationId'
      if (instanceName && token && customName) {
        try {
          await this.evolutionApiService.createEvolutionApiInstanceForUser(
            respLocationId, // El locationId del usuario GHL
            instanceName,   // El instanceName de Evolution API
            token,          // El token de la instancia
            customName,     // El customName de la instancia
          );
          // CAMBIO: Actualizar el mensaje de log
          this.logger.log(`Evolution API instance '${instanceName}' (Custom Name: '${customName}') stored for location '${respLocationId}'`);
        } catch (err) {
          this.logger.error(`Failed to store Evolution API instance: ${err.message}`);
        }
      }

      return res.status(200).send(this.generateSuccessHtml());
    } catch (error) {
      this.logger.error('Error exchanging GHL OAuth code for tokens:', error);
      const errorDesc =
        (error.response?.data as any)?.error_description ||
        (error.response?.data as any)?.error ||
        'Unknown GHL OAuth error';
      throw new HttpException(
        `Failed to obtain GHL tokens: ${errorDesc}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private generateSuccessHtml(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>OAuth Authentication Complete</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 40px; background: #f4f6f8; }
            .container { background: white; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #2d3436; margin-bottom: 20px; }
            .check { font-size: 48px; color: #4caf50; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="check">✅</div>
            <h1>Authentication Complete!</h1>
            <p>Your workspace has been successfully connected to WLINK.</p>
            <p>You can close this page.</p>
          </div>
        </body>
      </html>
    `;
  }
}
