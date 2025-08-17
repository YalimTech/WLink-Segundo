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

  // CAMBIO: Parámetro 'ghlUserId' a 'ghlLocationId'
  private async getHttpClient(ghlLocationId: string): Promise<AxiosInstance> {
    // CAMBIO: Usar 'locationId' para buscar usuario
    const userWithTokens = await this.prisma.getUserWithTokens(ghlLocationId);
    if (!userWithTokens?.accessToken || !userWithTokens?.refreshToken) {
      this.logger.error(
        `No tokens found for GHL User (Location ID): ${ghlLocationId}`,
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
        `Access token for User ${ghlLocationId} is expiring. Refreshing...`,
      );
      try {
        const newTokens = await this.refreshGhlAccessToken(
          userWithTokens.refreshToken,
        );
        // CAMBIO: Usar 'locationId' para actualizar tokens de usuario
        await this.prisma.updateUserTokens(
          ghlLocationId,
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
      // **CORRECCIÓN AQUÍ:** Se cambió 'GHL_CLIENT_CLIENT_ID' a 'GHL_CLIENT_ID'
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
   * @param ghlLocationId El ID del usuario de GHL (obtenido del callback OAuth).
   * @returns Los detalles del usuario de GHL o null si no se encuentra.
   */
  public async getGhlUserDetails(locationId: string, ghlLocationId: string): Promise<any | null> { // CAMBIO: Parámetro 'ghlUserId' a 'ghlLocationId'
    try {
      const httpClient = await this.getHttpClient(locationId);
      const response = await httpClient.get(`/users/${ghlLocationId}`); // Endpoint para obtener detalles del usuario
      this.logger.log(`Fetched GHL user details for ${ghlLocationId}: ${JSON.stringify(response.data)}`);
      return response.data?.user || response.data; // La respuesta puede variar, a veces viene en 'user'
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.logger.warn(`GHL User ${ghlLocationId} not found for location ${locationId}.`);
        return null;
      }
      this.logger.error(`Error fetching GHL user details for ${ghlLocationId}: ${error.message}`, error.stack);
      throw new IntegrationError(`Failed to fetch GHL user details: ${error.message}`);
    }
  }

  public async getGhlContactByPhone(
    locationId: string,
    phone: string,
  ): Promise<GhlContact | null> {
    const httpClient = await this.getHttpClient(locationId);
    const formattedPhone = phone?.startsWith('+')
      ? phone
      : `+${(phone || '').replace(/[^0-9]/g, '')}`;
    try {
      this.logger.log(`Looking up contact in GHL with phone: ${formattedPhone}`);
      const response = await httpClient.get(
        `/contacts/lookup?phone=${encodeURIComponent(formattedPhone)}`,
      );
      return response.data?.contacts?.[0] || null;
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      if (status === 404) {
        this.logger.warn(`Contact with phone ${formattedPhone} not found in GHL.`);
        return null;
      }
      this.logger.error(
        `Error fetching contact by phone in GHL. Status: ${status}, Data: ${JSON.stringify(axiosError.response?.data)}`,
      );
      throw error;
    }
  }

  public async getGhlContactById(
    locationId: string,
    contactId: string,
  ): Promise<GhlContact | null> {
    const httpClient = await this.getHttpClient(locationId);
    try {
      const { data } = await httpClient.get(`/contacts/${contactId}`);
      return (data?.contact || data) as GhlContact;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        this.logger.warn(`Contact ${contactId} not found for location ${locationId}.`);
        return null;
      }
      this.logger.error(
        `Error fetching contact by id in GHL. Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`,
      );
      throw error;
    }
  }

  private normalizePhoneE164(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/[^0-9]/g, '');
    return phone.startsWith('+') ? phone : `+${digits}`;
  }

  private normalizeDigits(phone: string): string {
    return (phone || '').replace(/[^0-9]/g, '');
  }

  private async sendWhatsAppMessageWithRetry(
    instanceToken: string,
    instanceName: string,
    toPhone: string,
    text: string,
  ): Promise<void> {
    // Primer intento: dígitos sin '+' (formato que Evolution suele aceptar)
    const digits = this.normalizeDigits(toPhone);
    try {
      await this.evolutionService.sendMessage(instanceToken, instanceName, digits, text);
      return;
    } catch (err: any) {
      const status = err?.response?.status;
      // Reintento con formato E.164
      try {
        const e164 = this.normalizePhoneE164(toPhone);
        await this.evolutionService.sendMessage(instanceToken, instanceName, e164, text);
        return;
      } catch (err2: any) {
        this.logger.error(`Error sending message via Evolution API (digits=${digits} / e164=${this.normalizePhoneE164(toPhone)}): ${status || ''} ${err2?.response?.status || ''}`);
        throw new IntegrationError('Failed to send message via Evolution API');
      }
    }
  }

  private async findOrCreateGhlContact(
    locationId: string,
    phone: string,
    name: string,
    instanceName: string, // CAMBIO: Parámetro 'instanceId' a 'instanceName'
  ): Promise<GhlContact> {
    const httpClient = await this.getHttpClient(locationId);
    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    // CAMBIO: Usar 'instanceName' para la etiqueta
    const tag = `whatsapp-instance-${instanceName}`; 

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
    instanceName: string, // CAMBIO: Parámetro 'instanceId' a 'instanceName'
  ): Promise<void> {
    // CAMBIO: Usar 'instanceName' para buscar la instancia
    const instance = await this.prisma.getInstance(instanceName); 
    if (!instance) throw new NotFoundError(`Instance ${instanceName} not found`); // CAMBIO: Usar 'instanceName'
    if (instance.state !== 'authorized')
      throw new IntegrationError(`Instance ${instanceName} is not authorized`); // CAMBIO: Usar 'instanceName'

    // Enviar con reintentos de formato (Evolution API varia exigencia del número)
    await this.sendWhatsAppMessageWithRetry(
      instance.apiTokenInstance,
      instance.instanceName,
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
    const instanceName = webhook.instance; // Este es el instanceName de Evolution API
    if (!instanceName) {
      this.logger.warn('[EvolutionApiService] Webhook received without an instance name. Ignoring.');
      return;
    }

    this.logger.log(
      `[EvolutionApiService] Processing webhook for instance: '${instanceName}', Event: '${webhook.event}'.`,
    );
    this.logger.debug(`[EvolutionApiService] Full Webhook Payload: ${JSON.stringify(webhook)}`);


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
      // CAMBIO: Usar 'instanceName' para actualizar el estado en la DB
      const updated = await this.prisma.updateInstanceState(instanceName, mappedStatus);
      
      if (updated) { 
        this.logger.log(`[EvolutionApiService] Instance '${instanceName}' state updated to '${mappedStatus}' via webhook.`);
      } else {
        this.logger.warn(`[EvolutionApiService] Webhook for instance '${instanceName}' received, but could not find/update it in DB. Check instance name.`);
      }
    } else if ((webhook.event === 'messages.upsert' || webhook.event === 'MESSAGES_UPSERT') && webhook.data?.key?.remoteJid) {
      // Buscar la instancia por su instanceName (que es el 'instance' del webhook)
      const instance = await this.prisma.getInstance(instanceName);
      if (!instance) {
        this.logger.warn(`[EvolutionApiService] Webhook 'messages.upsert' for unknown instance '${instanceName}'. Ignoring message.`);
        return;
      }

      const { data } = webhook;
      const senderPhone = data.key.remoteJid.split('@')[0];
      const senderName = data.pushName || `WhatsApp User ${senderPhone.slice(-4)}`;
      const ghlContact = await this.findOrCreateGhlContact(
        instance.locationId, // CAMBIO: Usar instance.locationId
        senderPhone,
        senderName,
        instance.instanceName, // CAMBIO: Usar instance.instanceName
      );
      const transformedMsg = this.transformer.toPlatformMessage(webhook);
      transformedMsg.contactId = ghlContact.id;
      transformedMsg.locationId = instance.locationId; // CAMBIO: Usar instance.locationId
      await this.postInboundMessageToGhl(instance.locationId, transformedMsg); // CAMBIO: Usar instance.locationId
      this.logger.log(`[EvolutionApiService] Message upsert processed for instance '${instanceName}'.`);
    } else {
      this.logger.log(`[EvolutionApiService] Evolution Webhook event '${webhook.event}' received for instance '${instanceName}'. No specific handler or missing data. Full Payload: ${JSON.stringify(webhook)}`);
    }
  }

  /**
   * Crea una nueva instancia en la base de datos y verifica sus credenciales con Evolution API.
   *
   * @param locationId El ID de la ubicación GHL del usuario al que pertenece la instancia.
   * @param evolutionApiInstanceName El identificador único de la instancia en Evolution API (lo que se ingresa en "Instance ID" del frontend).
   * @param apiToken El token de la API para la instancia (del campo "API Token" del frontend).
   * @param customName El nombre personalizado editable por el usuario (del campo "Instance Name (optional)" del frontend).
   */
  public async createEvolutionApiInstanceForUser(
    locationId: string, // CAMBIO: Parámetro 'userId' a 'locationId'
    evolutionApiInstanceName: string, // CAMBIO: Parámetro 'evolutionApiInstanceId' a 'evolutionApiInstanceName'
    apiToken: string,
    customName?: string,
    providedInstanceId?: string, // NUEVO: permitir que el cliente envíe el GUID/instanceId
  ): Promise<Instance> {
    this.logger.log(`[EvolutionApiService] Attempting to create instance: '${evolutionApiInstanceName}' (Custom: '${customName}') for location: '${locationId}'`); // CAMBIO: Logs
    
    // Comprobar si ya existe una instancia con este ID de Evolution API para este usuario.
    // Usamos `getInstance` que busca por `instanceName` (el campo único de Evolution API).
    const existing = await this.prisma.getInstance(evolutionApiInstanceName); // CAMBIO: Usar evolutionApiInstanceName
    if (existing && existing.locationId === locationId) { // CAMBIO: Usar existing.locationId y locationId
      this.logger.warn(`[EvolutionApiService] Instance '${evolutionApiInstanceName}' already exists for this location.`); // CAMBIO: Logs
      throw new HttpException(
        `An instance with ID '${evolutionApiInstanceName}' already exists for your WLink account.`, // CAMBIO: Mensaje
        HttpStatus.CONFLICT,
      );
    }

    try {
      this.logger.log(`[EvolutionApiService] Validating credentials for Evolution API Instance Name: '${evolutionApiInstanceName}'...`); // CAMBIO: Logs
      const isValid = await this.evolutionService.validateInstanceCredentials(
        apiToken, 
        evolutionApiInstanceName, // CAMBIO: Usar evolutionApiInstanceName
      );
      if (!isValid) {
        this.logger.error(`[EvolutionApiService] Invalid credentials for Evolution API Instance Name: '${evolutionApiInstanceName}'.`); // CAMBIO: Logs
        throw new Error('Invalid credentials provided for Evolution API Instance Name and Token.'); // CAMBIO: Mensaje
      }
      this.logger.log(`[EvolutionApiService] Credentials valid for '${evolutionApiInstanceName}'. Fetching initial status...`); // CAMBIO: Logs

      const statusInfo = await this.evolutionService.getInstanceStatus(
        apiToken,
        evolutionApiInstanceName, // CAMBIO: Usar evolutionApiInstanceName
      );
      
      const state = statusInfo?.instance?.state || 'close';
      const mappedState: InstanceState =
        state === 'open'
          ? 'authorized'
          : state === 'connecting'
          ? 'starting'
          : state === 'qrcode'
          ? 'qr_code'
          : 'notAuthorized';
      
      this.logger.log(`[EvolutionApiService] Initial status for '${evolutionApiInstanceName}' from Evolution API: '${state}'. Mapped to: '${mappedState}'`); // CAMBIO: Logs

      const newInstance = await this.prisma.createInstance({
        instanceName: evolutionApiInstanceName, // CAMBIO: instanceName será el ID único de Evolution API
        instanceId: providedInstanceId || statusInfo?.instance?.instanceId || null, // Preferir el proporcionado
        apiTokenInstance: apiToken, 
        user: { connect: { locationId: locationId } }, // CAMBIO: Usar locationId para conectar al usuario
        customName: customName || `Instance ${evolutionApiInstanceName}`, // Se usa el customName, o uno por defecto
        state: mappedState,
        settings: {},
      });
      this.logger.log(`[EvolutionApiService] Instance '${evolutionApiInstanceName}' created in DB with initial state: '${mappedState}'.`); // CAMBIO: Logs

      // Evolution API v2: configurar webhook para recibir mensajes y updates de conexión
      try {
        const appUrl = this.configService.get<string>('APP_URL');
        if (!appUrl) {
          this.logger.warn('[EvolutionApiService] APP_URL not configured; skipping webhook setup.');
        } else {
          const webhookUrl = `${appUrl.replace(/\/$/, '')}/webhooks/evolution`;
          const payload = {
            webhook: {
              url: webhookUrl,
              headers: {
                Authorization: `Bearer ${apiToken}`,
              },
              // Evolution API v2 usa eventos en MAYÚSCULAS con guiones bajos
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
              enabled: true,
            },
          } as any;
          await this.evolutionService.setWebhook(apiToken, evolutionApiInstanceName, payload);
          this.logger.log(`[EvolutionApiService] Webhook set for instance '${evolutionApiInstanceName}' -> ${webhookUrl}`);
        }
      } catch (whErr: any) {
        this.logger.error(`[EvolutionApiService] Failed to set webhook for instance '${evolutionApiInstanceName}': ${whErr.message}`);
      }
      return newInstance;
    } catch (error) {
      this.logger.error(
        `[EvolutionApiService] Failed to verify or create instance '${evolutionApiInstanceName}': ${error.message}. Stack: ${error.stack}`, // CAMBIO: Logs
      );
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Failed to verify Evolution API credentials or create instance.',
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
    const http = await this.getHttpClient(locationId);
    // Intento 1: endpoint REST estilo v2
    try {
      await http.put(`/conversations/messages/${encodeURIComponent(messageId)}/status`, {
        status,
        ...meta,
      });
      return;
    } catch (err1) {
      const s1 = (err1 as AxiosError).response?.status;
      const d1 = (err1 as AxiosError).response?.data;
      this.logger.warn(`PUT /conversations/messages/{id}/status failed: ${s1} ${JSON.stringify(d1)}`);
      // Intento 2: endpoint alternativo por body
      try {
        await http.post('/conversations/messages/status', {
          messageId,
          status,
          ...meta,
        });
        return;
      } catch (err2) {
        const s2 = (err2 as AxiosError).response?.status;
        const d2 = (err2 as AxiosError).response?.data;
        this.logger.error(`Failed to update GHL message status: ${s2} ${JSON.stringify(d2)}`);
      }
    }
  }

  private async postInboundMessageToGhl(
    locationId: string,
    message: GhlPlatformMessage,
  ): Promise<void> {
    this.logger.log(
      `Posting message to GHL for location ${locationId} (direction=${message.direction}): ${message.message}`,
    );
    // API v2 de GHL: crear mensaje en conversación
    const httpClient = await this.getHttpClient(locationId);

    // Asegurar campos mínimos
    if (!message.contactId) {
      throw new IntegrationError('Missing contactId to post inbound message to GHL');
    }

    const conversationProviderId = this.configService.get<string>('GHL_CONVERSATION_PROVIDER_ID');
    // Por defecto usar WHATSAPP para no caer en SMS si la env no está definida
    const messageTypeEnv = (this.configService.get<string>('GHL_MESSAGE_TYPE') || 'WHATSAPP').toUpperCase();

    const createMessage = async (override: Partial<Record<string, any>> = {}) => {
      // Para inbound, enviamos con channel/type y provider; si GHL valida distinto,
      // los reintentos de abajo probarán variantes sin estos campos.
      if ((message.direction || 'inbound') === 'inbound') {
        const inboundPayload: any = {
          locationId,
          contactId: message.contactId,
          channel: 'whatsapp',
          type: messageTypeEnv,
          direction: 'inbound',
          status: 'delivered',
          message: message.message,
          attachments: message.attachments ?? [],
          timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
          // Importante: NO incluir providerId para inbound; GHL podría tratarlo como saliente
          ...override,
        };
        return httpClient.post('/conversations/messages', inboundPayload);
      }

      // Para outbound, incluimos provider/canal
      const outboundPayload: any = {
        locationId,
        contactId: message.contactId,
        channel: 'whatsapp',
        type: messageTypeEnv,
        direction: 'outbound',
        status: 'sent',
        message: message.message,
        attachments: message.attachments ?? [],
        timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
        ...override,
      };
      outboundPayload.conversationProviderId = conversationProviderId;
      outboundPayload.providerId = conversationProviderId;
      return httpClient.post('/conversations/messages', outboundPayload);
    };

    try {
      const resp = await createMessage();
      // Tras crear el mensaje, forzamos el status explícito para evitar "pending/unsuccessful"
      try {
        const createdId = (resp as any)?.data?.message?.id || (resp as any)?.data?.id;
        if (createdId) {
          const finalStatus = (message.direction || 'inbound') === 'inbound' ? 'delivered' : 'sent';
          await this.updateGhlMessageStatus(locationId, createdId, finalStatus);
        }
      } catch {}
    } catch (err) {
      const axiosErr = err as AxiosError | any;
      const status = axiosErr?.response?.status;
      // Si GHL exige una conversación previa, la creamos y reintentamos
      if (status === 404 || status === 400) {
        try {
          const convo: any = {
            locationId,
            contactId: message.contactId,
            channel: 'whatsapp',
            type: messageTypeEnv,
          };
          if ((message.direction || 'inbound') === 'outbound') {
            convo.conversationProviderId = conversationProviderId;
            convo.providerId = conversationProviderId;
          }
          await httpClient.post('/conversations', convo);
          await createMessage();
          return;
        } catch (err2) {
          this.logger.error(
            `[EvolutionApiService] Failed to create conversation before posting message: ${JSON.stringify((err2 as any)?.response?.data)}`,
          );
        }
      }
      // Fallbacks por validación de esquema/enum
      if (status === 422) {
        try {
          await createMessage({ providerId: undefined });
          return;
        } catch {}
        try {
          await createMessage({ type: 'WHATSAPP' });
          return;
        } catch {}
        try {
          await createMessage({ type: 'SMS' });
          return;
        } catch {}
        // Intento adicional: eliminar channel/type/provider para la variante mínima
        try {
          await createMessage({ channel: undefined, type: undefined, conversationProviderId: undefined, providerId: undefined });
          return;
        } catch {}
      }
      this.logger.error(
        `[EvolutionApiService] Failed to post inbound message to GHL: ${status} ${JSON.stringify(axiosErr?.response?.data)}`,
      );
      throw new IntegrationError('Failed to post inbound message to GHL');
    }
  }
}
