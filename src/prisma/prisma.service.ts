//src/prisma/prisma.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StorageProvider, Settings } from '../evolutionapi';
import { User, Instance, InstanceState, UserCreateData, UserUpdateData } from '../types';

let PrismaClient: any;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch {
  PrismaClient = null;
}

export function parseId(id: string | number | bigint): string {
  return id.toString();
}

interface MemoryDB {
  users: Map<string, any>;
  instances: Map<string, any>;
}

@Injectable()
export class PrismaService
  implements OnModuleInit, StorageProvider<User, Instance & { user: User }, UserCreateData, UserUpdateData>
{
  private readonly logger = new Logger(PrismaService.name);
  private client: any = null;
  private memory: MemoryDB | null = null;

  constructor() {
    if (PrismaClient) {
      try {
        this.client = new PrismaClient();
      } catch (err: any) {
        this.logger.error(`Prisma client init failed: ${err.message}`);
      }
    }
    if (!this.client) {
      this.memory = { users: new Map(), instances: new Map() };
      this.logger.warn('Using in-memory Prisma fallback.');
    }
  }

  async onModuleInit() {
    if (this.client) {
      try {
        await this.client.$connect();
        this.logger.log('✅ Successfully connected to the database.');
      } catch (err: any) {
        this.logger.error(`DB connection failed: ${err.message}`);
        this.client = null;
        this.memory = { users: new Map(), instances: new Map() };
      }
    }
  }

  // --- MÉTODOS DE USUARIO ---
  async createUser(data: UserCreateData): Promise<User> {
    if (this.client) {
      // Usar 'locationId' para el upsert
      return this.client.user.upsert({
        where: { locationId: data.locationId as string }, // CAMBIO: Usar locationId
        update: data,
        create: data,
      });
    }
    this.memory!.users.set(data.locationId as string, { ...(data as any) }); // CAMBIO: Usar locationId como clave en memoria
    return data as any;
  }

  async findUser(locationId: string): Promise<User | null> { // CAMBIO: Parámetro 'id' a 'locationId'
    if (this.client) return this.client.user.findUnique({ where: { locationId } }); // CAMBIO: Usar locationId
    return this.memory!.users.get(locationId) || null; // CAMBIO: Usar locationId
  }

  async updateUser(locationId: string, data: UserUpdateData): Promise<User> { // CAMBIO: Parámetro 'id' a 'locationId'
    if (this.client)
      return this.client.user.update({ where: { locationId }, data }); // CAMBIO: Usar locationId
    const user = { ...(this.memory!.users.get(locationId) || {}), ...(data as any) }; // CAMBIO: Usar locationId
    this.memory!.users.set(locationId, user); // CAMBIO: Usar locationId
    return user as any;
  }

  // --- MÉTODOS DE INSTANCIA ---
  async createInstance(data: any): Promise<Instance & { user: User }> {
    if (this.client)
      // Asegurar que los datos enviados a Prisma coincidan con el schema
      // `data` debe contener instanceName, instanceId, apiTokenInstance, locationId, customName, state, settings
      return this.client.instance.create({ data, include: { user: true } });
    
    // Fallback en memoria: Asegúrate de que los campos estén correctamente asignados
    // CAMBIO: idInstance a instanceName; instanceGuid a instanceId; userId a locationId
    const instanceData = { 
        ...data, 
        instanceName: parseId(data.instanceName), // El campo clave es instanceName
        instanceId: data.instanceId, // Asegurar que instanceId también se pasa si existe
        locationId: data.locationId // Asegurar que locationId también se pasa
    }; 
    this.memory!.instances.set(instanceData.instanceName, instanceData); // CAMBIO: Usar instanceName como clave en memoria
    const user = this.memory!.users.get(data.locationId); // CAMBIO: Usar locationId para buscar el usuario
    return { ...instanceData, user } as any;
  }

  async getInstanceById(id: bigint): Promise<(Instance & { user: User }) | null> {
    if (this.client) {
      return this.client.instance.findUnique({
        where: { id },
        include: { user: true },
      });
    }
    for (const inst of this.memory!.instances.values()) {
      if (inst.id === id) { 
        const user = this.memory!.users.get(inst.locationId); // CAMBIO: Usar locationId
        return { ...inst, user } as any;
      }
    }
    return null;
  }

  async getInstance(instanceName: string): Promise<(Instance & { user: User }) | null> { // CAMBIO: Parámetro 'idInstance' a 'instanceName'
    if (this.client)
      return this.client.instance.findUnique({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        include: { user: true },
      });
    const inst = this.memory!.instances.get(parseId(instanceName)); // CAMBIO: Usar instanceName
    if (!inst) return null;
    const user = this.memory!.users.get(inst.locationId); // CAMBIO: Usar locationId
    return { ...inst, user } as any;
  }

  async getInstancesByLocationId(locationId: string): Promise<(Instance & { user: User })[]> { // CAMBIO: Parámetro 'userId' a 'locationId' y nombre del método
    if (this.client)
      return this.client.instance.findMany({ where: { locationId }, include: { user: true } }); // CAMBIO: Usar locationId
    const list: any[] = [];
    for (const inst of this.memory!.instances.values()) {
      if (inst.locationId === locationId) { // CAMBIO: Usar locationId
        list.push({ ...inst, user: this.memory!.users.get(locationId) }); // CAMBIO: Usar locationId
      }
    }
    return list as any;
  }

  async removeInstanceById(id: bigint): Promise<Instance & { user: User }> {
    if (this.client) {
      return this.client.instance.delete({
        where: { id },
        include: { user: true },
      });
    }
    const inst = await this.getInstanceById(id);
    if (!inst) throw new Error(`Instance with ID ${id} not found.`);
    // En el caso de memoria, eliminamos por el instanceName (que es la clave en el Map)
    this.memory!.instances.delete(parseId(inst.instanceName)); // CAMBIO: Usar instanceName
    return inst;
  }

  async removeInstance(instanceName: string): Promise<Instance & { user: User }> { // CAMBIO: Parámetro 'idInstance' a 'instanceName'
    if (this.client)
      return this.client.instance.delete({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        include: { user: true },
      });
    const inst = await this.getInstance(instanceName); // CAMBIO: Usar instanceName
    if (!inst) throw new Error(`Instance ${instanceName} not found.`); // CAMBIO: Usar instanceName
    this.memory!.instances.delete(parseId(instanceName)); // CAMBIO: Usar instanceName
    return inst;
  }

  /**
   * ✅ MÉTODO RENOMBRADO: Antes `updateInstanceName`.
   * Actualiza el nombre personalizado (customName) de una instancia.
   * El `name` en el esquema de Prisma se mapea a `customName` en la interfaz.
   */
  async updateInstanceCustomName(instanceName: string, customName: string): Promise<Instance & { user: User }> { // CAMBIO: Parámetro 'idInstance' a 'instanceName'
    if (this.client)
      return this.client.instance.update({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        data: { name: customName }, // 'name' es la columna en DB para 'customName'
        include: { user: true },
      });
    const inst = await this.getInstance(instanceName); // CAMBIO: Usar instanceName
    if (!inst) throw new Error(`Instance ${instanceName} not found.`); // CAMBIO: Usar instanceName
    (inst as any).customName = customName;
    this.memory!.instances.set(parseId(instanceName), inst); // CAMBIO: Usar instanceName
    return inst;
  }

  async updateInstanceState(instanceName: string, state: InstanceState): Promise<Instance & { user: User }> { // CAMBIO: Parámetro 'idInstance' a 'instanceName'
    if (this.client)
      return this.client.instance.update({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        data: { state: state },
        include: { user: true },
      });
    const inst = await this.getInstance(instanceName); // CAMBIO: Usar instanceName
    if (!inst) throw new Error(`Instance ${instanceName} not found.`); // CAMBIO: Usar instanceName
    (inst as any).state = state;
    this.memory!.instances.set(parseId(instanceName), inst); // CAMBIO: Usar instanceName
    return inst;
  }
  
  /**
   * ✅ MÉTODO RENOMBRADO: Antes `updateInstanceStateByName`.
   * Actualiza el estado de las instancias basándose en su `customName`.
   * El `name` en el esquema de Prisma se mapea a `customName` en la interfaz.
   */
  async updateInstanceStateByCustomName(customName: string, state: InstanceState): Promise<{ count: number }> {
    if (this.client) {
      this.logger.log(`Updating state for instance(s) with custom name '${customName}' to '${state}'`);
      return this.client.instance.updateMany({
        where: { name: customName }, // 'name' es la columna en DB para 'customName'
        data: { state },
      });
    }
    let count = 0;
    for (const [key, inst] of this.memory!.instances.entries()) {
      if (inst.customName === customName) { 
        inst.state = state;
        this.memory!.instances.set(key, inst);
        count++;
      }
    }
    this.logger.log(`In-memory update: ${count} instance(s) updated.`);
    return { count };
  }

  async updateInstanceSettings(instanceName: string, settings: Settings): Promise<Instance & { user: User }> { // CAMBIO: Parámetro 'idInstance' a 'instanceName'
    if (this.client)
      return this.client.instance.update({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        data: { settings: (settings || {}) as any },
        include: { user: true },
      });
    const inst = await this.getInstance(instanceName); // CAMBIO: Usar instanceName
    if (!inst) throw new Error(`Instance ${instanceName} not found.`); // CAMBIO: Usar instanceName
    (inst as any).settings = settings || {};
    this.memory!.instances.set(parseId(instanceName), inst); // CAMBIO: Usar instanceName
    return inst;
  }

  async findInstanceById(instanceId: string): Promise<(Instance & { user: User }) | null> { // CAMBIO: Renombrado de 'findInstanceByGuid' a 'findInstanceById', parámetro 'guid' a 'instanceId'
    if (this.client)
      return this.client.instance.findUnique({
        where: { instanceId: instanceId }, // CAMBIO: Usar instanceId
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
        if (inst.instanceId === instanceId) { // CAMBIO: Usar instanceId
            return { ...inst, user: this.memory!.users.get(inst.locationId) } as any; // CAMBIO: Usar locationId
        }
    }
    return null;
  }

  /**
   * ✅ MÉTODO CORREGIDO: Antes `getInstanceByIdInstanceAndToken`.
   * Busca una instancia por su `instanceName` (el ID único de Evolution API) y `apiTokenInstance`.
   */
  async getInstanceByNameAndToken(instanceName: string, apiTokenInstance: string): Promise<(Instance & { user: User }) | null> { // CAMBIO: Parámetro 'evolutionApiInstanceId' a 'instanceName', y nombre del método
    if (this.client)
      return this.client.instance.findFirst({
        where: { instanceName: parseId(instanceName), apiTokenInstance: apiTokenInstance }, // CAMBIO: Usar instanceName
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.instanceName === instanceName && inst.apiTokenInstance === apiTokenInstance) { // CAMBIO: Usar instanceName
        return { ...inst, user: this.memory!.users.get(inst.locationId) } as any; // CAMBIO: Usar locationId
      }
    }
    return null;
  }

  /**
   * ✅ MÉTODO RENOMBRADO: Antes `findInstanceByIdInstanceOnly`.
   * Busca una instancia por su `instanceName` (el ID único de Evolution API).
   */
  async findInstanceByNameOnly(instanceName: string): Promise<(Instance & { user: User }) | null> { // CAMBIO: Parámetro 'evolutionApiInstanceId' a 'instanceName', y nombre del método
    if (this.client)
      return this.client.instance.findFirst({
        where: { instanceName: parseId(instanceName) }, // CAMBIO: Usar instanceName
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.instanceName === instanceName) { // CAMBIO: Usar instanceName
        return { ...inst, user: this.memory!.users.get(inst.locationId) } as any; // CAMBIO: Usar locationId
      }
    }
    return null;
  }

  // --- OTROS MÉTODOS ---
  async getUserWithTokens(locationId: string): Promise<User | null> { // CAMBIO: Parámetro 'userId' a 'locationId'
    if (this.client) return this.client.user.findUnique({ where: { locationId } }); // CAMBIO: Usar locationId
    return this.memory!.users.get(locationId) || null; // CAMBIO: Usar locationId
  }

  async updateUserTokens(
    locationId: string, // CAMBIO: Parámetro 'userId' a 'locationId'
    accessToken: string,
    refreshToken: string,
    tokenExpiresAt: Date,
  ): Promise<User> {
    if (this.client)
      return this.client.user.update({
        where: { locationId }, // CAMBIO: Usar locationId
        data: { accessToken, refreshToken, tokenExpiresAt },
      });
    const user = (this.memory!.users.get(locationId) || {}) as any; // CAMBIO: Usar locationId
    Object.assign(user, { accessToken, refreshToken, tokenExpiresAt });
    this.memory!.users.set(locationId, user); // CAMBIO: Usar locationId
    return user as any;
  }
}
