//src/webhooks/guards/dynamic-instance.guard.spec.ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DynamicInstanceGuard } from './dynamic-instance.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

// CAMBIO: Actualizar mockInstance para usar instanceName en lugar de idInstance
const mockInstance = {
  instanceName: '123', // Renombrado de idInstance a instanceName
  apiTokenInstance: 'secret-token',
};

describe('DynamicInstanceGuard', () => {
  let guard: DynamicInstanceGuard;
  let prisma: Partial<PrismaService>;

  beforeEach(() => {
    // CAMBIO: getInstance ahora espera 'instanceName'
    prisma = { getInstance: jest.fn().mockResolvedValue(mockInstance) } as any;
    guard = new DynamicInstanceGuard(prisma as PrismaService);
  });

  const createContext = (body: any, auth?: string): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ body, headers: auth ? { authorization: auth } : {} } as Request),
    }),
  } as any);

  it('allows access with correct token', async () => {
    // 'instance' en el body corresponde al payload.instance del webhook, que es el instanceName
    const ctx = createContext({ instance: '123' }, 'Bearer secret-token'); 
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws if Authorization header is missing', async () => {
    const ctx = createContext({ instance: '123' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws if instance not found', async () => {
    (prisma.getInstance as jest.Mock).mockResolvedValue(null);
    // 'instance' en el body corresponde al instanceName
    const ctx = createContext({ instance: '999' }, 'Bearer secret-token'); 
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws if token does not match', async () => {
    // 'instance' en el body corresponde al instanceName
    const ctx = createContext({ instance: '123' }, 'Bearer wrong'); 
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
