// src/evolution-api/evolution-api.transformer.ts
import { Injectable, Logger } from '@nestjs/common';
import { MessageTransformer } from '../core/base-adapter';
import { GhlPlatformMessage, EvolutionWebhook } from '../types';

// Utilidad exportada para extraer de forma robusta el texto del mensaje del webhook de Evolution API
export function getMessageBody(message: any): string {
  if (!message) return '';
  try {
    if (typeof message.conversation === 'string' && message.conversation.trim()) {
      return message.conversation;
    }
    const ext = message.extendedTextMessage?.text;
    if (typeof ext === 'string' && ext.trim()) {
      return ext;
    }
    const imgCaption = message.imageMessage?.caption;
    if (typeof imgCaption === 'string' && imgCaption.trim()) {
      return imgCaption;
    }
    const vidCaption = message.videoMessage?.caption;
    if (typeof vidCaption === 'string' && vidCaption.trim()) {
      return vidCaption;
    }
    const btnText = message.buttonsResponseMessage?.selectedDisplayText;
    if (typeof btnText === 'string' && btnText.trim()) {
      return btnText;
    }
    const listTitle = message.listResponseMessage?.title || message.listResponseMessage?.singleSelectReply?.selectedRowId;
    if (typeof listTitle === 'string' && listTitle.trim()) {
      return listTitle;
    }
  } catch {}
  return '';
}

@Injectable()
export class EvolutionApiTransformer implements MessageTransformer<GhlPlatformMessage, EvolutionWebhook> {
  private readonly logger = new Logger(EvolutionApiTransformer.name);

  toPlatformMessage(webhook: EvolutionWebhook): GhlPlatformMessage {
    const extracted = getMessageBody((webhook as any)?.data?.message);
    const messageText = extracted && extracted.trim() ? extracted : 'Unsupported message type';
    
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
      type: 'WHATSAPP',
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
