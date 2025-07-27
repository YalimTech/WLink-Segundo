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
  locationId?: string | null; // Aunque 'id' es locationId, a veces el payload de GHL lo repite.
  firstName?: string | null; // Nuevo: Campo para el nombre del usuario de GHL
  lastName?: string | null;  // Nuevo: Campo para el apellido del usuario de GHL
  email?: string | null;     // Nuevo: Campo para el email del usuario de GHL
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  instances?: Instance[];
  createdAt: Date;
  updatedAt: Date; // Asegúrate de que este campo exista en tu schema.prisma también.
}

export interface Instance {
  id: bigint;
  idInstance: string;
  name: string;
  apiTokenInstance: string;
  instanceGuid?: string | null; // Puede ser opcional si no siempre se usa
  state?: InstanceState | null; // Puede ser opcional si no siempre tiene un estado
  settings: any;
  userId: string;
  user?: User;
  createdAt: Date;
  updatedAt?: Date; // Si lo agregaste en schema.prisma, inclúyelo aquí
}

// =================================================================
// DTOs (Data Transfer Objects) para peticiones HTTP
// =================================================================

export interface CreateInstanceDto {
  locationId: string;
  instanceId: string;
  token: string;
  instanceName: string;
}

export interface UpdateInstanceDto {
  name: string;
}

// =================================================================
// Tipos para creación y actualización en Prisma
// =================================================================

// UserCreateData ahora puede incluir firstName, lastName, email
export type UserCreateData = Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'instances' | 'hasTokens'> & { id?: string };
// UserUpdateData ahora es más flexible para actualizar campos parciales
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
  instance: string;
  data: any;
  sender?: string;
  destination?: string;
  // ✅ CORRECCIÓN: Permitir que el timestamp sea string o number para mayor flexibilidad.
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

// ✅ ACTUALIZACIÓN: GhlUserData para reflejar los datos que recibes de GHL
export interface GhlUserData {
  userId: string;
  companyId: string;
  type: 'location' | 'agency';
  activeLocation?: string;
  locationId?: string;
  // Añadidos campos que se pueden obtener del usuario de GHL
  firstName?: string;
  lastName?: string;
  email?: string;
  fullName?: string; // GHL a veces envía fullName
  // Otros campos que GHL pueda devolver en el payload inicial o al consultar el usuario
  // ...
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

