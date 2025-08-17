// src/evolution-api/evolution-api.transformer.ts
import { Injectable, Logger } from '@nestjs/common';
import { MessageTransformer } from '../core/base-adapter';
import { GhlPlatformMessage, EvolutionWebhook } from '../types';

@Injectable()
export class EvolutionApiTransformer implements MessageTransformer<GhlPlatformMessage, EvolutionWebhook> {
  private readonly logger = new Logger(EvolutionApiTransformer.name);

  toPlatformMessage(webhook: EvolutionWebhook): GhlPlatformMessage {
    let messageText = 'Unsupported message type';
    if (webhook.data.message?.conversation) {
      messageText = webhook.data.message.conversation;
    } else if (webhook.data.message?.extendedTextMessage) {
      messageText = webhook.data.message.extendedTextMessage.text;
    }
    
    // Determinar dirección: si viene del número de la instancia (fromMe=true) es outbound, si no inbound
    const rawFromMe: boolean | undefined = webhook.data?.key?.fromMe as any;
    const statusStr: string = (webhook.data?.status || '').toString().toUpperCase();
    // Evolution v2 en algunos despliegues no marca fromMe, pero los envíos propios llegan con status 'SERVER_ACK'.
    const isFromAgent = rawFromMe === true || statusStr === 'SERVER_ACK';
    const platformMessage: Partial<GhlPlatformMessage> = {
      direction: isFromAgent ? 'outbound' : 'inbound',
      message: messageText.trim(),
      timestamp: webhook.timestamp ? new Date(Number(webhook.timestamp) * 1000) : new Date(),
    };

    return platformMessage as GhlPlatformMessage;
  }

  fromPlatformMessage(message: GhlPlatformMessage): any {
    if (message.message) {
      return {
        phone: message.phone,
        text: message.message,
      };
    }
    throw new Error('Cannot transform an empty GHL message.');
  }
}
