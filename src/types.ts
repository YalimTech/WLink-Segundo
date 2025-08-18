// src/types.ts
import { Request } from 'express';

// =================================================================
// TIPOS CENTRALES (Reflejan el schema.prisma)
// =================================================================

export type InstanceState =
  | 'notAuthorized'
  | 'qr_code'
  | 'authorized'
  | 'yellowCard'
  | 'blocked'
  | 'starting';

export interface User {
  // CAMBIO: Renombrado de 'id' a 'locationId' para concordancia con GHL
  locationId: string;
  companyId?: string | null;
  // ID del usuario/agente de GHL para atribución de mensajes outbound
  ghlUserId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  instances?: Instance[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Instance {
  id: bigint;
  // CAMBIO: Renombrado de 'idInstance' a 'instanceName' para concordancia con Evolution API
  instanceName: string; // Identificador único de Evolution API (no modificable). Este es el 'instanceName' de Evolution API.
  // CAMBIO: Renombrado de 'instanceGuid' a 'instanceId' para concordancia con Evolution API
  instanceId?: string | null; // GUID único generado por Evolution API (si se proporciona), también conocido como 'instanceId' en Evolution API.
  customName?: string | null; // Nombre o descripción editable por el cliente desde su panel
  apiTokenInstance: string;
  state?: InstanceState | null;
  settings: any;
  // CAMBIO: Renombrado de 'userId' a 'locationId' para concordancia con User.locationId (GHL)
  locationId: string;
  user?: User; // La relación con el modelo User
  createdAt: Date;
  updatedAt: Date;
}

// =================================================================
// DTOs (Data Transfer Objects) para peticiones HTTP
// =================================================================

export interface CreateInstanceDto {
  locationId: string; // ID de la ubicación GHL a la que pertenece la instancia
  // CAMBIO: Renombrado de 'evolutionApiInstanceId' a 'instanceName'
  instanceName: string; // El ID único y no modificable de la instancia en Evolution API (lo que se ingresa en "Instance ID")
  // CAMBIO: Renombrado de 'apiToken' a 'token' (ajustando a tu estructura actual)
  token: string; // El token de la API para la instancia (lo que se ingresa en "API Token")
  // CAMBIO: Asegurado que se llame 'customName'
  customName?: string; // El nombre personalizado/editable por el usuario (lo que se ingresa en "Instance Name (optional)")
  // NUEVO: Permitir enviar el GUID/ID interno de Evolution API cuando el usuario lo proporciona
  instanceId: string; // GUID/ID de la instancia en Evolution API (obligatorio según el flujo solicitado)
}

export interface UpdateInstanceDto {
  customName: string; // Para actualizar el nombre personalizado
}

// =================================================================
// Tipos para creación y actualización en Prisma
// =================================================================

// CAMBIO: Actualizado para usar 'locationId' en lugar de 'id' en User
export type UserCreateData = Omit<User, 'locationId' | 'createdAt' | 'updatedAt' | 'instances' | 'hasTokens'> & { locationId?: string };
export type UserUpdateData = Partial<Omit<User, 'locationId' | 'createdAt' | 'updatedAt' | 'instances' | 'hasTokens'>>;


// =================================================================
// Interfaces para Webhooks de Evolution API
// =================================================================

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
  // El campo 'instance' del webhook de Evolution API corresponde a nuestro 'instanceName'
  instance: string; 
  data: any;
  sender?: string;
  destination?: string;
  timestamp?: string | number;
  server_url?: string;
}

// =================================================================
// Interfaces para GoHighLevel (GHL)
// =================================================================

export interface AuthReq extends Request {
  locationId: string; // El ID de la ubicación de GHL
  userData?: GhlUserData;
}

export interface GhlUserData {
  // CAMBIO: Renombrado de 'userId' a 'locationId' para concordancia con User.locationId
  locationId: string; 
  companyId: string;
  type: 'location' | 'agency';
  activeLocation?: string; // Este campo también es locationId en GHL
  firstName?: string;
  lastName?: string;
  email?: string;
  fullName?: string;
}

export interface GhlPlatformAttachment {
  url: string;
  fileName?: string;
  type?: string;
}

export interface MessageStatusPayload {
  status?: 'delivered' | 'read' | 'failed' | 'pending' | 'sent';
  error?: any;
  // Identificador del Conversation Provider registrado en HighLevel
  conversationProviderId?: string;
  // Algunos tenants aceptan también 'providerId' como alias
  providerId?: string;
}

export interface GhlPlatformMessage {
  contactId?: string;
  locationId: string;
  phone?: string;
  message: string;
  direction: 'inbound' | 'outbound';
  // Tipo requerido por GHL v2 Conversations (ej.: 'WHATSAPP')
  type?: 'WHATSAPP' | 'SMS' | 'EMAIL' | 'INSTAGRAM' | 'MESSENGER' | 'UNKNOWN';
  attachments?: GhlPlatformAttachment[];
  timestamp?: Date;
  // Opcional: para mensajes outbound, GHL usa userId para pintarlos del lado del agente
  userId?: string;
}

export interface GhlContactUpsertRequest {
  name?: string | null;
  locationId: string;
  phone?: string | null;
  tags?: string[];
  source?: string;
  avatarUrl?: string | null;
}

export interface GhlContact {
  id: string; // ID interno del contacto GHL
  name: string;
  locationId: string;
  phone: string;
  tags: string[];
}

export interface GhlContactUpsertResponse {
  contact: GhlContact;
}
