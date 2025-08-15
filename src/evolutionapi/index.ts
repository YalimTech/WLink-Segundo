// src/evolutionapi/index.ts
import { User, Instance, InstanceState, UserCreateData, UserUpdateData } from '../types';
import { ExecutionContext, Logger, CanActivate } from '@nestjs/common';
import { Request } from 'express';

export interface Settings {
  [key: string]: any;
}

// --- Interfaces de Almacenamiento (StorageProvider) ---
// Define el "contrato" que cualquier servicio de base de datos debe cumplir.
export interface StorageProvider<U, V, C, D> {
  // Métodos de Usuario
  // CAMBIO: Parámetro 'identifier' a 'locationId' para concordancia con GHL
  createUser(data: C): Promise<U>;
  findUser(locationId: string): Promise<U | null>;
  updateUser(locationId: string, data: D): Promise<U>;

  // Métodos de Instancia
  createInstance(data: any): Promise<V>;
  // CAMBIO: Renombrado de 'idInstance' a 'instanceName'
  getInstance(instanceName: string): Promise<V | null>;
  // CAMBIO: Renombrado de 'getInstancesByUserId' a 'getInstancesByLocationId' y parámetro a 'locationId'
  getInstancesByLocationId(locationId: string): Promise<V[]>;
  // CAMBIO: Renombrado de 'removeInstance(idInstance)' a 'removeInstance(instanceName)'
  removeInstance(instanceName: string): Promise<V>;
  // CAMBIO: Renombrado de 'updateInstanceName' a 'updateInstanceCustomName' y parámetros
  updateInstanceCustomName(instanceName: string, customName: string): Promise<V>;
  // CAMBIO: Renombrado de 'idInstance' a 'instanceName'
  updateInstanceState(instanceName: string, state: InstanceState): Promise<V>;
  // CAMBIO: Renombrado de 'idInstance' a 'instanceName'
  updateInstanceSettings(instanceName: string, settings: Settings): Promise<V>;

  // Métodos adicionales que tu PrismaService puede tener (ej. para tokens GHL)
  getUserWithTokens?(locationId: string): Promise<U | null>;
  updateUserTokens?(
    locationId: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiresAt: Date,
  ): Promise<U>;
}

// --- Interfaces de Transformación de Mensajes ---
export interface MessageTransformer<T, U> {
  toPlatformMessage(payload: U): T;
  fromPlatformMessage(message: T): any;
}

// --- Clases de Errores Personalizados ---
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

// --- Clases Base para Seguridad (Guards) ---
// Resuelve el error "has no exported member 'BaseEvolutionApiAuthGuard'"
export abstract class BaseEvolutionApiAuthGuard implements CanActivate {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly storageService: StorageProvider<any, any, any, any>,
  ) {}

  abstract canActivate(context: ExecutionContext): Promise<boolean>;

  protected async validateRequest(request: Request): Promise<boolean> {
    const apiToken = request.headers['apikey'] as string;
    if (!apiToken) {
      this.logger.warn('Missing API key in request headers.');
      return false;
    }
    // Aquí se puede añadir lógica futura para validar el token si es necesario
    return true;
  }
}
