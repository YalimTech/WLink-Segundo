// src/evolution-api/evolution-api.service.ts
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  BaseAdapter,
  NotFoundError,
  IntegrationError,
} from '../core/base-adapter';
import { EvolutionApiTransformer } from './evolution-api.transformer';
import { PrismaService, parseId } from '../prisma/prisma.service';
import { EvolutionService } from '../evolution/evolution.service';
import { GhlWebhookDto } from './dto/ghl-webhook.dto';
import {
  User,
  Instance,
  GhlPlatformMessage,
  EvolutionWebhook,
  GhlContact,
  GhlContactUpsertRequest,
  GhlContactUpsertResponse,
  MessageStatusPayload,
  InstanceState,
} from '../types';

@Injectable()
export class EvolutionApiService extends BaseAdapter<
  GhlPlatformMessage,
  EvolutionWebhook,
  User,
  Instance
> {
  private readonly ghlApiBaseUrl = 'https://services.leadconnectorhq.com';
  private readonly ghlApiVersion = '2021-07-28';

  constructor(
    protected readonly evolutionApiTransformer: EvolutionApiTransformer,
    protected readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly evolutionService: EvolutionService,
    logger: Logger,
  ) {
    super(evolutionApiTransformer, prisma, logger);
  }

  private async getHttpClient(ghlUserId: string): Promise<AxiosInstance> {
    const userWithTokens = await this.prisma.getUserWithTokens(ghlUserId);
    if (!userWithTokens?.accessToken || !userWithTokens?.refreshToken) {
      this.logger.error(
        `No tokens found for GHL User (Location ID): ${ghlUserId}`,
      );
      throw new HttpException(
        `GHL auth tokens not found. Please re-authorize the application.`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    let currentAccessToken = userWithTokens.accessToken;
    const willExpireSoon =
      userWithTokens.tokenExpiresAt &&
      new Date(userWithTokens.tokenExpiresAt).getTime() <
        Date.now() + 5 * 60 * 1000;

    if (willExpireSoon) {
      this.logger.log(
        `Access token for User ${ghlUserId} is expiring. Refreshing...`,
      );
      try {
        const newTokens = await this.refreshGhlAccessToken(
          userWithTokens.refreshToken,
        );
        await this.prisma.updateUserTokens(
          ghlUserId,
          newTokens.access_token,
          newTokens.refresh_token,
          new Date(Date.now() + newTokens.expires_in * 1000),
        );
        currentAccessToken = newTokens.access_token;
      } catch (err) {
        throw new HttpException(
          `Unable to refresh GHL token. Please re-authorize.`,
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    return axios.create({
      baseURL: this.ghlApiBaseUrl,
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
        Version: this.ghlApiVersion,
        'Content-Type': 'application/json',
      },
    });
  }

  private async refreshGhlAccessToken(refreshToken: string): Promise<any> {
    const body = new URLSearchParams({
      client_id: this.configService.get('GHL_CLIENT_ID')!,
      client_secret: this.configService.get('GHL_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      user_type: 'Location',
    });
    const response = await axios.post(
      `${this.ghlApiBaseUrl}/oauth/token`,
      body,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    return response.data;
  }

  /**
   * ✅ NUEVO MÉTODO: Obtiene los detalles de un usuario de GHL por su ID.
   * @param locationId El ID de la ubicación (para obtener el token de acceso).
   * @param ghlUserId El ID del usuario de GHL (obtenido del callback OAuth).
   * @returns Los detalles del usuario de GHL o null si no se encuentra.
   */
  public async getGhlUserDetails(locationId: string, ghlUserId: string): Promise<any | null> {
    try {
      const httpClient = await this.getHttpClient(locationId);
      const response = await httpClient.get(`/users/${ghlUserId}`); // Endpoint para obtener detalles del usuario
      this.logger.log(`Fetched GHL user details for ${ghlUserId}: ${JSON.stringify(response.data)}`);
      return response.data?.user || response.data; // La respuesta puede variar, a veces viene en 'user'
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(`GHL User ${ghlUserId} not found for location ${locationId}.`);
        return null;
      }
      this.logger.error(`Error fetching GHL user details for ${ghlUserId}: ${error.message}`, error.stack);
      throw new IntegrationError(`Failed to fetch GHL user details: ${error.message}`);
    }
  }

  public async getGhlContactByPhone(
    locationId: string,
    phone: string,
  ): Promise<GhlContact | null> {
    const httpClient = await this.getHttpClient(locationId);
    try {
      const response = await httpClient.get(
        `/contacts/lookup?phone=${encodeURIComponent(phone)}`,
      );
      return response.data?.contacts?.[0] || null;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) {
        return null;
      }
      this.logger.error(
        `Error fetching contact by phone in GHL: ${(error as AxiosError).message}`,
      );
      throw error;
    }
  }

  private async findOrCreateGhlContact(
    locationId: string,
    phone: string,
    name: string,
    instanceId: string,
  ): Promise<GhlContact> {
    const httpClient = await this.getHttpClient(locationId);
    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    const tag = `whatsapp-instance-${instanceId}`;

    const upsertPayload: GhlContactUpsertRequest = {
      name: name || `WhatsApp User ${formattedPhone.slice(-4)}`,
      locationId: locationId,
      phone: formattedPhone,
      tags: [tag],
      source: 'EvolutionAPI Integration',
    };

    const { data } = await httpClient.post<GhlContactUpsertResponse>(
      '/contacts/upsert',
      upsertPayload,
    );
    if (!data?.contact) {
      throw new IntegrationError(
        'Could not get contact from GHL upsert response.',
      );
    }
    return data.contact;
  }

  public async handlePlatformWebhook(
    ghlWebhook: GhlWebhookDto,
    instanceId: string,
  ): Promise<void> {
    const instance = await this.prisma.getInstance(instanceId);
    if (!instance) throw new NotFoundError(`Instance ${instanceId} not found`);
    if (instance.state !== 'authorized')
      throw new IntegrationError(`Instance ${instanceId} is not authorized`);

    await this.evolutionService.sendMessage(
      instance.apiTokenInstance,
      instance.idInstance, // Usa idInstance como el "name" de Evolution API
      ghlWebhook.phone,
      ghlWebhook.message,
    );
    await this.updateGhlMessageStatus(
      ghlWebhook.locationId,
      ghlWebhook.messageId,
      'delivered',
    );
  }

  /**
   * Maneja los webhooks entrantes de Evolution API.
   * ✅ MEJORA: Más logs para depurar el estado de la instancia.
   */
  public async handleEvolutionWebhook(webhook: EvolutionWebhook): Promise<void> {
    const instanceName = webhook.instance; // Este es el idInstance de Evolution API
    if (!instanceName) {
      this.logger.warn('[EvolutionApiService] Webhook received without an instance name. Ignoring.');
      return;
    }

    this.logger.log(
      `[EvolutionApiService] Processing webhook for instance: '${instanceName}', Event: '${webhook.event}'.`,
    );
    this.logger.debug(`[EvolutionApiService] Full Webhook Payload for '${instanceName}': ${JSON.stringify(webhook)}`);


    if (webhook.event === 'connection.update' && typeof webhook.data?.state !== 'undefined') {
      const state = webhook.data.state;
      let mappedStatus: InstanceState;

      switch (state) {
        case 'open': // Evolution API uses 'open' for authorized
          mappedStatus = 'authorized';
          break;
        case 'connecting':
          mappedStatus = 'starting';
          break;
        case 'close': // Evolution API uses 'close' for disconnected
          mappedStatus = 'notAuthorized';
          break;
        case 'qrcode': // Sometimes the state might directly be 'qrcode'
          mappedStatus = 'qr_code';
          break;
        default:
          this.logger.warn(`[EvolutionApiService] Unknown connection state received for '${instanceName}': '${state}'. Not updating state.`);
          return;
      }
      
      this.logger.log(`[EvolutionApiService] Attempting to update instance '${instanceName}' state from webhook. Mapped Status: '${mappedStatus}'`);
      // Usa idInstance para actualizar el estado en la DB
      const updated = await this.prisma.updateInstanceState(instanceName, mappedStatus); // CAMBIO: Usar updateInstanceState por idInstance
      if (updated.count > 0) {
        this.logger.log(`[EvolutionApiService] Instance '${instanceName}' state updated to '${mappedStatus}' via webhook. Rows affected: ${updated.count}`);
      } else {
        this.logger.warn(`[EvolutionApiService] Webhook for instance '${instanceName}' received, but could not find/update it in DB. Check instance name.`);
      }
    } else if (webhook.event === 'messages.upsert' && webhook.data?.key?.remoteJid) {
      // Buscar la instancia por su idInstance (que es el 'instance' del webhook)
      const instance = await this.prisma.getInstance(instanceName); // CAMBIO: Usar getInstance por idInstance
      if (!instance) {
        this.logger.warn(`[EvolutionApiService] Webhook 'messages.upsert' for unknown instance '${instanceName}'. Ignoring message.`);
        return;
      }

      const { data } = webhook;
      const senderPhone = data.key.remoteJid.split('@')[0];
      const senderName = data.pushName || `WhatsApp User ${senderPhone.slice(-4)}`;
      const ghlContact = await this.findOrCreateGhlContact(
        instance.userId,
        senderPhone,
        senderName,
        instance.idInstance,
      );
      const transformedMsg = this.transformer.toPlatformMessage(webhook);
      transformedMsg.contactId = ghlContact.id;
      transformedMsg.locationId = instance.userId;
      await this.postInboundMessageToGhl(instance.userId, transformedMsg);
      this.logger.log(`[EvolutionApiService] Message upsert processed for instance '${instanceName}'.`);
    } else {
      this.logger.log(`[EvolutionApiService] Evolution Webhook event '${webhook.event}' received for instance '${instanceName}'. No specific handler or missing data. Full Payload: ${JSON.stringify(webhook)}`);
    }
  }

  /**
   * Crea una nueva instancia en la base de datos y verifica sus credenciales con Evolution API.
   * ✅ MEJORA: Más logs para depurar el estado inicial de la instancia.
   */
  public async createEvolutionApiInstanceForUser(
    userId: string,
    instanceId: string, // Esto es el GUID que se guarda en instanceGuid
    token: string,
    customName: string, // CAMBIO: 'instanceName' a 'customName'
  ): Promise<Instance> {
    this.logger.log(`[EvolutionApiService] Attempting to create instance: '${customName}' for user: '${userId}'`); // CAMBIO: 'instanceName' a 'customName'
    const existing = await this.prisma.getInstanceByNameAndToken( // Este método busca por 'name' y 'token'
      customName, // CAMBIO: 'instanceName' a 'customName'
      token,
    );
    if (existing) {
      this.logger.warn(`[EvolutionApiService] Instance '${customName}' with this name and token already exists.`); // CAMBIO: 'instanceName' a 'customName'
      throw new HttpException(
        `An instance with this name and token already exists in WLink.`,
        HttpStatus.CONFLICT,
      );
    }

    try {
      this.logger.log(`[EvolutionApiService] Validating credentials for '${customName}'...`); // CAMBIO: 'instanceName' a 'customName'
      const isValid = await this.evolutionService.validateInstanceCredentials(
        token,
        customName, // CAMBIO: 'instanceName' a 'customName'
      );
      if (!isValid) {
        this.logger.error(`[EvolutionApiService] Invalid credentials for '${customName}'.`); // CAMBIO: 'instanceName' a 'customName'
        throw new Error('Invalid credentials');
      }
      this.logger.log(`[EvolutionApiService] Credentials valid for '${customName}'. Fetching initial status...`); // CAMBIO: 'instanceName' a 'customName'

      const statusInfo = await this.evolutionService.getInstanceStatus(
        token,
        customName, // CAMBIO: 'instanceName' a 'customName'
      );
      
      const state = statusInfo?.instance?.state || 'close'; // Evolution API uses 'open', 'connecting', 'close'
      const mappedState: InstanceState =
        state === 'open'
          ? 'authorized'
          : state === 'connecting'
          ? 'starting'
          : state === 'qrcode' // Add qrcode state for initial mapping
          ? 'qr_code'
          : 'notAuthorized';
      
      this.logger.log(`[EvolutionApiService] Initial status for '${customName}' from Evolution API: '${state}'. Mapped to: '${mappedState}'`); // CAMBIO: 'instanceName' a 'customName'

      const newInstance = await this.prisma.createInstance({
        idInstance: parseId(customName), // CAMBIO: idInstance ahora será el customName
        instanceGuid: instanceId, // instanceGuid en tu DB es el ID real de la instancia
        apiTokenInstance: token,
        user: { connect: { id: userId } },
        customName: customName, // CAMBIO: 'name' a 'customName'
        state: mappedState,
        settings: {},
      });
      this.logger.log(`[EvolutionApiService] Instance '${customName}' created in DB with initial state: '${mappedState}'.`); // CAMBIO: 'instanceName' a 'customName'
      return newInstance;
    } catch (error) {
      this.logger.error(
        `[EvolutionApiService] Failed to verify or create instance '${customName}': ${error.message}. Stack: ${error.stack}`, // CAMBIO: 'instanceName' a 'customName'
      );
      throw new HttpException(
        'Invalid credentials or API error',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  public async updateGhlMessageStatus(
    locationId: string,
    messageId: string,
    status: 'delivered' | 'read' | 'failed' | 'sent',
    meta: Partial<MessageStatusPayload> = {},
  ): Promise<void> {
    this.logger.log(
      `Updating message ${messageId} status to ${status} for location ${locationId}`,
    );
  }

  private async postInboundMessageToGhl(
    locationId: string,
    message: GhlPlatformMessage,
  ): Promise<void> {
    this.logger.log(
      `Posting inbound message to GHL for location ${locationId}: ${message.message}`,
    );
  }
}


