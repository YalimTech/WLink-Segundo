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
} from '@nestjs/common';
import { Response, Request } from 'express';
import { EvolutionApiService } from '../evolution-api/evolution-api.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GhlWebhookDto } from '../evolution-api/dto/ghl-webhook.dto';
// Importa el tipo correcto del webhook desde tu archivo central de tipos
import { EvolutionWebhook } from '../types';
import { DynamicInstanceGuard } from './guards/dynamic-instance.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly logger: Logger,
    private readonly evolutionApiService: EvolutionApiService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService, // Prisma se mantiene por si lo usas en el webhook de GHL
  ) {}

  @Post('evolution')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DynamicInstanceGuard)
  async handleEvolutionWebhook(
    // Tipamos el payload correctamente para asegurar la estructura
    @Body() payload: EvolutionWebhook, 
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`Received Evolution Webhook for instance: ${payload.instance}`);
    // Responde inmediatamente a la API para evitar timeouts. Esta es una práctica recomendada.
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      if (!payload.instance) {
        this.logger.warn('Webhook received without an instance ID. Ignoring.');
        return;
      }
      
      // --- LLAMADA CORREGIDA: Se pasa un solo argumento (el payload completo) ---
      // El servicio se encargará de extraer el instanceId y el resto de los datos.
      await this.evolutionApiService.handleEvolutionWebhook(payload);

    } catch (error) {
      this.logger.error(`Error processing Evolution webhook: ${error.message}`, error.stack);
    }
  }

  @Post('ghl')
  @HttpCode(HttpStatus.OK)
  async handleGhlWebhook(
    @Body() ghlWebhook: GhlWebhookDto, 
    @Req() request: Request, 
    @Res() res: Response,
  ): Promise<void> {
    const locationId = ghlWebhook.locationId || request.headers['x-location-id'] as string;
    const messageId = ghlWebhook.messageId;
    
    this.logger.debug(`Received GHL Webhook for location ${locationId}`);
    
    // Es importante responder a GHL rápidamente también.
    res.status(HttpStatus.OK).send('Webhook received');

    try {
      const conversationProviderId = ghlWebhook.conversationProviderId === this.configService.get('GHL_CONVERSATION_PROVIDER_ID');
      if (!conversationProviderId) {
        this.logger.warn(`Wrong conversation provider ID. Ignoring webhook.`);
        return;
      }
      if (!locationId) {
        throw new BadRequestException('Location ID is missing from GHL webhook.');
      }

      let instanceId: string | null = null;
      const contact = await this.evolutionApiService.getGhlContactByPhone(locationId, ghlWebhook.phone);
      
      if (contact?.tags) {
        instanceId = this.extractInstanceIdFromTags(contact.tags);
      }

      // Si no encontramos la etiqueta, usamos la primera instancia como fallback.
      if (!instanceId) {
        this.logger.warn(`No instance tag found for contact ${ghlWebhook.phone}. Using fallback.`);
        const instances = await this.prisma.getInstancesByUserId(locationId);
        if (instances.length > 0) {
          instanceId = instances[0].idInstance;
        } else {
          this.logger.error(`No instances found for location ${locationId}. Cannot send message.`);
          return;
        }
      }
      
      if (ghlWebhook.type === 'SMS' && (ghlWebhook.message || ghlWebhook.attachments?.length)) {
        await this.evolutionApiService.handlePlatformWebhook(ghlWebhook, instanceId!);
      }

    } catch (error) {
      this.logger.error(`Error processing GHL webhook for location ${locationId}: ${error.message}`, error.stack);
      if (locationId && messageId) {
        await this.evolutionApiService.updateGhlMessageStatus(locationId, messageId, 'failed', {
          error: { message: error.message || 'Failed to process outbound message' },
        });
      }
    }
  }

  private extractInstanceIdFromTags(tags: string[]): string | null {
    if (!tags || tags.length === 0) return null;
    const instanceTag = tags.find(tag => tag.startsWith('whatsapp-instance-'));
    return instanceTag ? instanceTag.replace('whatsapp-instance-', '') : null;
  }
}
