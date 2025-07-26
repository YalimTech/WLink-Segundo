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
      return this.client.user.upsert({
        where: { id: data.id as string },
        update: data,
        create: data,
      });
    }
    this.memory!.users.set(data.id as string, { ...(data as any) });
    return data as any;
  }

  async findUser(id: string): Promise<User | null> {
    if (this.client) return this.client.user.findUnique({ where: { id } });
    return this.memory!.users.get(id) || null;
  }

  async updateUser(id: string, data: UserUpdateData): Promise<User> {
    if (this.client)
      return this.client.user.update({ where: { id }, data });
    const user = { ...(this.memory!.users.get(id) || {}), ...(data as any) };
    this.memory!.users.set(id, user);
    return user as any;
  }

  // --- MÉTODOS DE INSTANCIA ---
  async createInstance(data: any): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.create({ data, include: { user: true } });
    this.memory!.instances.set(parseId(data.idInstance), { ...(data as any) });
    const user = this.memory!.users.get(data.userId);
    return { ...(data as any), user } as any;
  }

  async getInstance(idInstance: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findUnique({
        where: { idInstance: parseId(idInstance) },
        include: { user: true },
      });
    const inst = this.memory!.instances.get(parseId(idInstance));
    if (!inst) return null;
    const user = this.memory!.users.get(inst.userId);
    return { ...inst, user } as any;
  }

  async getInstancesByUserId(userId: string): Promise<(Instance & { user: User })[]> {
    if (this.client)
      return this.client.instance.findMany({ where: { userId }, include: { user: true } });
    const list: any[] = [];
    for (const inst of this.memory!.instances.values()) {
      if (inst.userId === userId) {
        list.push({ ...inst, user: this.memory!.users.get(userId) });
      }
    }
    return list as any;
  }

  async removeInstance(idInstance: string): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.delete({
        where: { idInstance: parseId(idInstance) },
        include: { user: true },
      });
    const inst = await this.getInstance(idInstance);
    if (!inst) throw new Error(`Instance ${idInstance} not found.`);
    this.memory!.instances.delete(parseId(idInstance));
    return inst;
  }

  async updateInstanceName(idInstance: string, name: string): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.update({
        where: { idInstance: parseId(idInstance) },
        data: { name },
        include: { user: true },
      });
    const inst = await this.getInstance(idInstance);
    if (!inst) throw new Error(`Instance ${idInstance} not found.`);
    (inst as any).name = name;
    this.memory!.instances.set(parseId(idInstance), inst);
    return inst;
  }

  async updateInstanceState(idInstance: string, state: InstanceState): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.update({
        where: { idInstance: parseId(idInstance) },
        data: { state: state },
        include: { user: true },
      });
    const inst = await this.getInstance(idInstance);
    if (!inst) throw new Error(`Instance ${idInstance} not found.`);
    (inst as any).state = state;
    this.memory!.instances.set(parseId(idInstance), inst);
    return inst;
  }
  
  // ✅ --- CORRECCIÓN: MÉTODO AÑADIDO ---
  /**
   * Actualiza el estado de una o más instancias buscándolas por su nombre único.
   * @param instanceName - El nombre de la instancia (ej: 'YC2').
   * @param state - El nuevo estado (ej: 'authorized').
   * @returns El número de registros actualizados.
   */
  async updateInstanceStateByName(instanceName: string, state: InstanceState): Promise<{ count: number }> {
    if (this.client) {
      this.logger.log(`Updating state for instance(s) with name '${instanceName}' to '${state}'`);
      return this.client.instance.updateMany({
        where: { name: instanceName },
        data: { state },
      });
    }
    // Fallback para la base de datos en memoria
    let count = 0;
    for (const [key, inst] of this.memory!.instances.entries()) {
      if (inst.name === instanceName) {
        inst.state = state;
        this.memory!.instances.set(key, inst);
        count++;
      }
    }
    this.logger.log(`In-memory update: ${count} instance(s) updated.`);
    return { count };
  }

  async updateInstanceSettings(idInstance: string, settings: Settings): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.update({
        where: { idInstance: parseId(idInstance) },
        data: { settings: (settings || {}) as any },
        include: { user: true },
      });
    const inst = await this.getInstance(idInstance);
    if (!inst) throw new Error(`Instance ${idInstance} not found.`);
    (inst as any).settings = settings || {};
    this.memory!.instances.set(parseId(idInstance), inst);
    return inst;
  }

  async findInstanceByGuid(guid: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findUnique({
        where: { instanceGuid: guid },
        include: { user: true },
      });
    return this.getInstance(guid);
  }

  async getInstanceByNameAndToken(name: string, token: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findFirst({
        where: { name, apiTokenInstance: token },
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.name === name && inst.apiTokenInstance === token) {
        return { ...inst, user: this.memory!.users.get(inst.userId) } as any;
      }
    }
    return null;
  }

  async findInstanceByNameOnly(name: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findFirst({
        where: { name },
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.name === name) {
        return { ...inst, user: this.memory!.users.get(inst.userId) } as any;
      }
    }
    return null;
  }

  // --- OTROS MÉTODOS ---
  async getUserWithTokens(userId: string): Promise<User | null> {
    if (this.client) return this.client.user.findUnique({ where: { id: userId } });
    return this.memory!.users.get(userId) || null;
  }

  async updateUserTokens(
    userId: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiresAt: Date,
  ): Promise<User> {
    if (this.client)
      return this.client.user.update({
        where: { id: userId },
        data: { accessToken, refreshToken, tokenExpiresAt },
      });
    const user = (this.memory!.users.get(userId) || {}) as any;
    Object.assign(user, { accessToken, refreshToken, tokenExpiresAt });
    this.memory!.users.set(userId, user);
    return user as any;
  }
}

