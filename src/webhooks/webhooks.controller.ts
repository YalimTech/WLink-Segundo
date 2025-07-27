//src/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
  Logger,
  UseGuards,
  Param, // Importamos Param para ser explícitos si se usa en la URL
} from '@nestjs/common';
import { Response, Request } from 'express';
import { EvolutionApiService } from '../evolution-api/evolution-api.service';
import { ConfigService } from '@nestjs/config'; // Mantenemos esta importación de @nestjs/config
import { PrismaService } from '../prisma/prisma.service';
import { GhlWebhookDto } from '../evolution-api/dto/ghl-webhook.dto';
import { EvolutionWebhook, InstanceState } from '../types';
import { DynamicInstanceGuard } from './guards/dynamic-instance.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly logger: Logger,
    private readonly evolutionApiService: EvolutionApiService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    // No necesitamos inyectar EvolutionApiTransformer aquí, ya que el servicio lo inyecta.
  ) {}

  @Post('evolution') // Si Evolution API envía el instanceId en la URL, se necesitaría @Param('instanceId') pathInstanceId: string, aquí.
  @HttpCode(HttpStatus.OK)
  @UseGuards(DynamicInstanceGuard)
  async handleEvolutionWebhook(
    @Body() payload: EvolutionWebhook,
    @Res() res: Response,
  ): Promise<void> {
    // ✅ LOG: Registramos el evento recibido y el payload completo para depuración.
    this.logger.log(
      `Received Evolution Webhook for instance: ${payload.instance || 'N/A'}, Event: ${payload.event}. Full Payload: ${JSON.stringify(payload)}`,
    );
    // ✅ Importante: Envía la respuesta 200 OK inmediatamente para evitar reintentos del webhook.
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      if (!payload.instance) {
        this.logger.warn('Webhook received without an instance name. Ignoring.');
        return;
      }

      // ✅ CORRECCIÓN PRINCIPAL para el error "Cannot read properties of undefined (reading 'state')":
      // Añadimos una verificación explícita para payload.data y payload.event.
      // Esto previene errores si el payload no tiene la estructura esperada para un evento.
      if (payload.event === 'connection.update') {
        // Para 'connection.update', esperamos 'data' y 'data.state'.
        if (!payload.data || typeof payload.data.state === 'undefined') {
          this.logger.error(
            `Evolution Webhook 'connection.update' received, but 'data' or 'data.state' is missing/undefined for instance: ${payload.instance}. Full Payload: ${JSON.stringify(payload)}`,
          );
          return; // Ignoramos este webhook para evitar el crash si el estado es inesperado.
        }
        // Si todo está en orden, delegamos al servicio.
        await this.evolutionApiService.handleEvolutionWebhook(payload);
      } else if (payload.event === 'messages.upsert') {
        // Para 'messages.upsert', esperamos 'data.key.remoteJid'.
        if (!payload.data?.key?.remoteJid) {
            this.logger.warn(`Webhook 'messages.upsert' for instance ${payload.instance} is missing remoteJid. Ignoring. Full Payload: ${JSON.stringify(payload)}`);
            return;
        }
        await this.evolutionApiService.handleEvolutionWebhook(payload);
      } else {
        // ✅ LOG: Registramos otros eventos que puedan llegar pero que no tienen un manejador específico aquí.
        this.logger.log(`Evolution Webhook event '${payload.event}' received for instance ${payload.instance}. No specific handler implemented in controller. Full Payload: ${JSON.stringify(payload)}`);
        // Si necesitas manejar otros eventos, deberías añadir más `else if` o delegar al servicio
        // para un manejo más genérico si corresponde.
      }
      
      this.logger.log(`Evolution Webhook processed successfully for instance: ${payload.instance}, Event: ${payload.event}.`);

    } catch (error) {
      // ✅ LOG: Mejoramos el log de errores para incluir más detalles y el stack.
      this.logger.error(
        `Error processing Evolution webhook for instance ${payload.instance || 'N/A'}, Event: ${payload.event || 'N/A'}: ${error.message}. Stack: ${error.stack}`,
      );
      // No podemos enviar un status de error aquí porque ya enviamos 200 OK antes.
    }
  }

  @Post('ghl')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DynamicInstanceGuard) // Asumo que GHL webhooks también podrían usar este guard si es necesario
  async handleGhlWebhook(
    @Body() ghlWebhook: GhlWebhookDto,
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    const locationId =
      ghlWebhook.locationId || (request.headers['x-location-id'] as string);
    const messageId = ghlWebhook.messageId;

    this.logger.debug(`Received GHL Webhook for location ${locationId}. Payload: ${JSON.stringify(ghlWebhook)}`); // LOG: Añadimos payload GHL
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      const conversationProviderId =
        ghlWebhook.conversationProviderId ===
        this.configService.get('GHL_CONVERSATION_PROVIDER_ID');
      if (!conversationProviderId) {
        this.logger.warn(`Wrong conversation provider ID. Ignoring GHL webhook.`);
        return;
      }
      if (!locationId) {
        throw new BadRequestException('Location ID is missing from GHL webhook.');
      }

      let instanceId: string | null = null;
      const contact = await this.evolutionApiService.getGhlContactByPhone(
        locationId,
        ghlWebhook.phone,
      );

      if (contact?.tags) {
        instanceId = this.extractInstanceIdFromTags(contact.tags);
      }

      if (!instanceId) {
        this.logger.warn(
          `No instance tag found for contact ${ghlWebhook.phone}. Using fallback.`,
        );
        const instances = await this.prisma.getInstancesByUserId(locationId);
        if (instances.length > 0) {
          instanceId = instances[0].idInstance;
        } else {
          this.logger.error(
            `No instances found for location ${locationId}. Cannot send message.`,
          );
          return;
        }
      }

      if (
        ghlWebhook.type === 'SMS' &&
        (ghlWebhook.message || ghlWebhook.attachments?.length)
      ) {
        await this.evolutionApiService.handlePlatformWebhook(
          ghlWebhook,
          instanceId!,
        );
      }
      this.logger.log(`GHL Webhook processed successfully for location ${locationId}, Message ID: ${messageId}`); // LOG
    } catch (error) {
      this.logger.error(
        `Error processing GHL webhook for location ${locationId}: ${error.message}. Stack: ${error.stack}`, // LOG: Más detalles del error
      );
      if (locationId && messageId) {
        await this.evolutionApiService.updateGhlMessageStatus(
          locationId,
          messageId,
          'failed',
          {
            error: { message: error.message || 'Failed to process outbound message' },
          },
        );
      }
    }
  }

  private extractInstanceIdFromTags(tags: string[]): string | null {
    if (!tags || tags.length === 0) return null;
    const instanceTag = tags.find((tag) => tag.startsWith('whatsapp-instance-'));
    return instanceTag ? instanceTag.replace('whatsapp-instance-', '') : null;
  }
}
