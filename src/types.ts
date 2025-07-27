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
  id: string;
  companyId?: string | null;
  locationId?: string | null;
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
  idInstance: string; // Identificador único de Evolution API (no modificable). Este es el 'instanceName' de Evolution API.
  instanceGuid?: string | null; // GUID único generado por Evolution API (si se proporciona)
  customName?: string | null; // Nombre o descripción editable por el cliente desde su panel
  apiTokenInstance: string;
  state?: InstanceState | null;
  settings: any;
  userId: string;
  user?: User;
  createdAt: Date;
  updatedAt: Date; // Asegúrate de que este campo exista en tu schema.prisma también.
}

// =================================================================
// DTOs (Data Transfer Objects) para peticiones HTTP
// =================================================================

export interface CreateInstanceDto {
  locationId: string;
  evolutionApiInstanceId: string; // El ID único y no modificable de la instancia en Evolution API (lo que se ingresa en "Instance ID")
  apiToken: string; // El token de la API para la instancia (lo que se ingresa en "API Token")
  customName?: string; // El nombre personalizado/editable por el usuario (lo que se ingresa en "Instance Name (optional)")
}

export interface UpdateInstanceDto {
  customName: string; // Para actualizar el nombre personalizado
}

// =================================================================
// Tipos para creación y actualización en Prisma
// =================================================================

export type UserCreateData = Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'instances' | 'hasTokens'> & { id?: string };
export type UserUpdateData = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'instances' | 'hasTokens'>>;


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
  instance: string; // Se refiere al idInstance único de Evolution API
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
  locationId: string;
  userData?: GhlUserData;
}

export interface GhlUserData {
  userId: string;
  companyId: string;
  type: 'location' | 'agency';
  activeLocation?: string;
  locationId?: string;
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

