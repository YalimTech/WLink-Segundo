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
    // Decidir dirección SOLO por 'fromMe' para evitar falsos positivos por 'status'
    const isFromAgent = webhook.data?.key?.fromMe === true;
    const ts = ((): Date => {
      const raw = (webhook as any)?.data?.messageTimestamp || (webhook as any)?.timestamp;
      if (!raw) return new Date();
      const n = Number(raw);
      return isNaN(n) ? new Date() : new Date(n * 1000);
    })();
    const platformMessage: Partial<GhlPlatformMessage> = {
      direction: isFromAgent ? 'outbound' : 'inbound',
      message: messageText.trim(),
      timestamp: ts,
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
