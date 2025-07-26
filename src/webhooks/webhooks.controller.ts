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
import { ConfigService } from '@nestjs/config';
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
    this.logger.log(
      `Received Evolution Webhook for instance: ${payload.instance || 'N/A'}, Event: ${payload.event}`,
    );
    // ✅ Importante: Envía la respuesta 200 OK inmediatamente para evitar reintentos del webhook.
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      if (!payload.instance) {
        this.logger.warn('Webhook received without an instance name. Ignoring.');
        return;
      }

      // ✅ CORRECCIÓN PRINCIPAL: Delegar completamente el procesamiento del webhook al servicio.
      // El servicio (EvolutionApiService) ya contiene la lógica de mapeo de estados completa
      // y la actualización de la base de datos a través de EvolutionApiTransformer.
      await this.evolutionApiService.handleEvolutionWebhook(payload);

      this.logger.log(`Evolution Webhook processed successfully for instance: ${payload.instance}`);

    } catch (error) {
      this.logger.error(
        `Error processing Evolution webhook for instance ${payload.instance || 'N/A'}: ${error.message}`,
        error.stack,
      );
      // No podemos enviar un status de error aquí porque ya enviamos 200 OK antes.
    }
  }

  @Post('ghl')
  @HttpCode(HttpStatus.OK)
  async handleGhlWebhook(
    @Body() ghlWebhook: GhlWebhookDto,
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    const locationId =
      ghlWebhook.locationId || (request.headers['x-location-id'] as string);
    const messageId = ghlWebhook.messageId;

    this.logger.debug(`Received GHL Webhook for location ${locationId}`);
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      const conversationProviderId =
        ghlWebhook.conversationProviderId ===
        this.configService.get('GHL_CONVERSATION_PROVIDER_ID');
      if (!conversationProviderId) {
        this.logger.warn(`Wrong conversation provider ID. Ignoring webhook.`);
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
    } catch (error) {
      this.logger.error(
        `Error processing GHL webhook for location ${locationId}: ${error.message}`,
        error.stack,
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
