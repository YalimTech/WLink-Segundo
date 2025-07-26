import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DynamicInstanceGuard } from './dynamic-instance.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

const mockInstance = {
  idInstance: '123',
  apiTokenInstance: 'secret-token',
};

describe('DynamicInstanceGuard', () => {
  let guard: DynamicInstanceGuard;
  let prisma: Partial<PrismaService>;

  beforeEach(() => {
    prisma = { getInstance: jest.fn().mockResolvedValue(mockInstance) } as any;
    guard = new DynamicInstanceGuard(prisma as PrismaService);
  });

  const createContext = (body: any, auth?: string): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({ body, headers: auth ? { authorization: auth } : {} } as Request),
    }),
  } as any);

  it('allows access with correct token', async () => {
    const ctx = createContext({ instance: '123' }, 'Bearer secret-token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws if Authorization header is missing', async () => {
    const ctx = createContext({ instance: '123' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws if instance not found', async () => {
    (prisma.getInstance as jest.Mock).mockResolvedValue(null);
    const ctx = createContext({ instance: '999' }, 'Bearer secret-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws if token does not match', async () => {
    const ctx = createContext({ instance: '123' }, 'Bearer wrong');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
