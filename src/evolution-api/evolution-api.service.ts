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
      instance.name,
      ghlWebhook.phone,
      ghlWebhook.message,
    );
    await this.updateGhlMessageStatus(
      ghlWebhook.locationId,
      ghlWebhook.messageId,
      'delivered',
    );
  }

  public async handleEvolutionWebhook(webhook: EvolutionWebhook): Promise<void> {
    const instanceName = webhook.instance;
    if (!instanceName) {
      this.logger.warn('Webhook received without an instance name. Ignoring.');
      return;
    }

    this.logger.log(
      `Processing webhook for instance: ${instanceName}, Event: ${webhook.event}`,
    );

    // ✅ CORRECCIÓN N.º 1: Usar el nombre del evento correcto: 'connection.update'
    if (webhook.event === 'connection.update' && webhook.data?.state) {
      const state = webhook.data.state;
      let mappedStatus: InstanceState;

      switch (state) {
        case 'open':
          mappedStatus = 'authorized';
          break;
        case 'connecting':
          mappedStatus = 'starting';
          break;
        case 'close':
          mappedStatus = 'notAuthorized';
          break;
        default:
          this.logger.warn(`Unknown connection state received: ${state}`);
          return;
      }
      
      // ✅ CORRECCIÓN N.º 2: Actualizar la instancia por su NOMBRE, no por su ID.
      const updated = await this.prisma.updateInstanceStateByName(instanceName, mappedStatus);
      if (updated.count > 0) {
        this.logger.log(`Instance ${instanceName} state updated to ${mappedStatus} via webhook.`);
      } else {
        this.logger.warn(`Webhook for unknown instance ${instanceName}. Could not update state.`);
      }
    }

    if (webhook.event === 'messages.upsert' && webhook.data?.key?.remoteJid) {
      // ✅ CORRECCIÓN N.º 2: Buscar la instancia por su NOMBRE.
      const instance = await this.prisma.findInstanceByNameOnly(instanceName);
      if (!instance) {
        this.logger.warn(`Webhook for unknown instance ${instanceName}. Ignoring message.`);
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
    }
  }

  public async createEvolutionApiInstanceForUser(
    userId: string,
    instanceId: string,
    token: string,
    instanceName: string,
  ): Promise<Instance> {
    const existing = await this.prisma.getInstanceByNameAndToken(
      instanceName,
      token,
    );
    if (existing) {
      throw new HttpException(
        `An instance with this name and token already exists in WLink.`,
        HttpStatus.CONFLICT,
      );
    }

    try {
      const isValid = await this.evolutionService.validateInstanceCredentials(
        token,
        instanceName,
      );
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      const statusInfo = await this.evolutionService.getInstanceStatus(
        token,
        instanceName,
      );
      
      const state = statusInfo?.instance?.state || 'close';
      const mappedState: InstanceState =
        state === 'open'
          ? 'authorized'
          : state === 'connecting'
          ? 'starting'
          : 'notAuthorized';

      const newInstance = await this.prisma.createInstance({
        idInstance: parseId(instanceName),
        instanceGuid: instanceId,
        apiTokenInstance: token,
        user: { connect: { id: userId } },
        name: instanceName,
        state: mappedState,
        settings: {},
      });

      return newInstance;
    } catch (error) {
      this.logger.error(
        `Failed to verify or create instance ${instanceName}: ${error.message}`,
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

