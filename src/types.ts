// src/types.ts

import { Request } from 'express';

// =================================================================
// TIPOS CENTRALES (Reflejan el schema.prisma)
// =================================================================

/**
 * Define los estados posibles de una instancia.
 * ✅ CORRECCIÓN: Coincide exactamente con el enum en `prisma/schema.prisma`.
 */
export type InstanceState =
  | 'notAuthorized'
  | 'qr_code'
  | 'authorized'
  | 'yellowCard'
  | 'blocked'
  | 'starting';

/**
 * ✅ MEJORA: Interfaz para el modelo User, reemplaza 'any'.
 */
export interface User {
  id: string;
  companyId?: string | null;
  locationId?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  instances?: Instance[]; // Relación opcional
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ✅ MEJORA: Interfaz para el modelo Instance, reemplaza 'any'.
 */
export interface Instance {
  id: bigint;
  idInstance: string;
  name: string;
  apiTokenInstance: string;
  instanceGuid: string;
  state: InstanceState;
  settings: any; // 'any' se mantiene si la estructura de settings es variable.
  userId: string;
  user?: User; // Relación opcional
  createdAt: Date;
  updatedAt: Date;
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

// ✅ MEJORA: Tipos más seguros para las operaciones de Prisma.
export type UserCreateData = Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'instances'> & { id?: string };
export type UserUpdateData = Partial<UserCreateData>;

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
  data: any; // Se mantiene 'any' porque la estructura de 'data' varía mucho según el evento.
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


