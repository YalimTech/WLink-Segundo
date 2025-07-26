// src/types.ts

import { Request } from 'express';
// Importa los tipos directamente desde el cliente de Prisma generado
// Los tipos de Prisma pueden no estar disponibles si no se ha generado el cliente.
// Para evitar errores de compilación en entornos sin acceso a los binarios de
// Prisma, se definen tipos básicos compatibles.
export type InstanceState =
  | 'notAuthorized'
  | 'not_authorized'
  | 'qr_code'
  | 'authorized'
  | 'yellowCard'
  | 'blocked'
  | 'starting';

export type User = any;
export type Instance = any;

// --- DTOs (Data Transfer Objects) para las peticiones HTTP ---
export interface CreateInstanceDto {
  locationId: string;
  instanceId: string;   // <-- Este campo recibirá el GUID de la instancia.
  token: string;        // <-- Este campo recibirá el API Token.
  instanceName: string; // <-- Este campo recibirá el nombre legible (ej. "YC2").
}
export interface UpdateInstanceDto {
  name: string;
}

// --- Tipos para la creación y actualización en Prisma ---
// Usa los tipos generados por Prisma para mayor seguridad
export type UserCreateData = any;
export type UserUpdateData = any;

// --- Interfaces para Webhooks de Evolution API ---
export interface MessageKey {
  remoteJid: string;
  fromMe: boolean;
  id: string;
}
export interface MessageData {
  key: MessageKey;
  pushName?: string;
  message?: { conversation?: string; extendedTextMessage?: { text: string }; [key: string]: any; };
  messageTimestamp: number;
  [key: string]: any;
}
export interface EvolutionWebhook {
  event: string;
  instance: string;
  data: MessageData;
  sender: string;
  type?: string;
  timestamp?: number;
}

// --- Interfaces para GoHighLevel (GHL) ---
export interface AuthReq extends Request {
  locationId: string;
  userData?: GhlUserData;
}

export interface GhlUserData {
  userId: string;
  companyId: string;
  type: 'location' | 'agency';
  activeLocation?: string;
  locationId?: string;
}

export interface GhlPlatformAttachment {
  url: string;
  fileName?: string;
  type?: string;
}
export interface MessageStatusPayload {
  status?: 'delivered' | 'read' | 'failed' | 'pending' | 'sent';
  error?: any;
}
export interface GhlPlatformMessage {
  contactId?: string;
  locationId: string;
  phone?: string;
  message: string;
  direction: 'inbound' | 'outbound';
  attachments?: GhlPlatformAttachment[];
  timestamp?: Date;
}
export interface GhlContactUpsertRequest {
  name?: string | null;
  locationId: string;
  phone?: string | null;
  tags?: string[];
  source?: string;
}
export interface GhlContact {
  id: string;
  name: string;
  locationId: string;
  phone: string;
  tags: string[];
}
export interface GhlContactUpsertResponse {
  contact: GhlContact;
}

