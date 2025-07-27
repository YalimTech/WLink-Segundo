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
      // `data` debe contener idInstance, instanceGuid, apiTokenInstance, userId, customName, state, settings
      return this.client.instance.create({ data, include: { user: true } });
    
    // Fallback en memoria: Asegúrate de que los campos estén correctamente asignados
    const instanceData = { ...data, idInstance: parseId(data.idInstance) }; // Asegura que idInstance sea string para la clave
    this.memory!.instances.set(instanceData.idInstance, instanceData);
    const user = this.memory!.users.get(data.userId);
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
      // Comparar directamente BigInt con BigInt si es posible, o convertir para comparación
      if (inst.id === id) { 
        const user = this.memory!.users.get(inst.userId);
        return { ...inst, user } as any;
      }
    }
    return null;
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

  /**
   * ✅ --- CORRECCIÓN APLICADA AQUÍ ---
   * Se añade el nuevo método para borrar la instancia usando su ID numérico (BigInt).
   * Esto es necesario para que el método deleteInstance del controlador funcione.
   */
  async removeInstanceById(id: bigint): Promise<Instance & { user: User }> {
    if (this.client) {
      return this.client.instance.delete({
        where: { id },
        include: { user: true },
      });
    }
    const inst = await this.getInstanceById(id);
    if (!inst) throw new Error(`Instance with ID ${id} not found.`);
    // En el caso de memoria, eliminamos por el idInstance (que es la clave en el Map)
    this.memory!.instances.delete(parseId(inst.idInstance));
    return inst;
  }
  // --- FIN DE LA CORRECCIÓN ---

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

  /**
   * ✅ MÉTODO RENOMBRADO: Antes `updateInstanceName`.
   * Actualiza el nombre personalizado (customName) de una instancia.
   * El `name` en el esquema de Prisma se mapea a `customName` en la interfaz.
   */
  async updateInstanceCustomName(idInstance: string, customName: string): Promise<Instance & { user: User }> {
    if (this.client)
      return this.client.instance.update({
        where: { idInstance: parseId(idInstance) },
        data: { name: customName }, // 'name' es la columna en DB para 'customName'
        include: { user: true },
      });
    const inst = await this.getInstance(idInstance);
    if (!inst) throw new Error(`Instance ${idInstance} not found.`);
    (inst as any).customName = customName; // Actualizar el campo 'customName' en memoria
    // Si en memoria la propiedad es 'name', se debería actualizar 'name': (inst as any).name = customName;
    // Esto depende de cómo se almacenan las propiedades en el objeto `inst` en el Map `memory.instances`.
    // Si `customName` se guarda como `customName` en el objeto, esta línea es correcta.
    // Si se guarda como `name`, entonces: `(inst as any).name = customName;`
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
      if (inst.customName === customName) { // Usar customName para la comparación en memoria
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
    // En el fallback en memoria, si `getInstance` busca por `idInstance`, y el GUID
    // no es siempre igual al `idInstance`, esto puede ser incorrecto.
    // Debería buscar específicamente por `instanceGuid`.
    for (const inst of this.memory!.instances.values()) {
        if (inst.instanceGuid === guid) {
            return { ...inst, user: this.memory!.users.get(inst.userId) } as any;
        }
    }
    return null;
  }

  /**
   * ✅ MÉTODO CORREGIDO: Antes `getInstanceByNameAndToken`.
   * Busca una instancia por su `idInstance` (el ID único de Evolution API) y `apiTokenInstance`.
   */
  async getInstanceByIdInstanceAndToken(evolutionApiInstanceId: string, apiTokenInstance: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findFirst({
        where: { idInstance: parseId(evolutionApiInstanceId), apiTokenInstance: apiTokenInstance }, // Buscar por idInstance
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.idInstance === evolutionApiInstanceId && inst.apiTokenInstance === apiTokenInstance) {
        return { ...inst, user: this.memory!.users.get(inst.userId) } as any;
      }
    }
    return null;
  }

  /**
   * ✅ MÉTODO RENOMBRADO: Antes `findInstanceByNameOnly`.
   * Busca una instancia por su `idInstance` (el ID único de Evolution API).
   */
  async findInstanceByIdInstanceOnly(evolutionApiInstanceId: string): Promise<(Instance & { user: User }) | null> {
    if (this.client)
      return this.client.instance.findFirst({
        where: { idInstance: parseId(evolutionApiInstanceId) }, // Buscar por idInstance
        include: { user: true },
      });
    for (const inst of this.memory!.instances.values()) {
      if (inst.idInstance === evolutionApiInstanceId) {
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

