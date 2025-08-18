import { EvolutionApiService } from './evolution-api.service';
import { EvolutionApiTransformer } from './evolution-api.transformer';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EvolutionService } from '../evolution/evolution.service';
import { Logger, HttpException } from '@nestjs/common';

describe('createEvolutionApiInstanceForUser', () => {
  let service: EvolutionApiService;
  let prisma: any;
  let evo: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      getInstance: jest.fn().mockResolvedValue(null),
      getInstanceByNameAndToken: jest.fn().mockResolvedValue(null),
      createInstance: jest.fn(),
    } as Partial<PrismaService>;
    evo = {
      validateInstanceCredentials: jest.fn(),
      getInstanceStatus: jest.fn(),
    } as Partial<EvolutionService>;
    config = { get: jest.fn().mockReturnValue('globalKey') } as Partial<ConfigService>;
    service = new EvolutionApiService(
      {} as EvolutionApiTransformer,
      prisma as PrismaService,
      config as ConfigService,
      evo as EvolutionService,
      new Logger('test'),
    );
  });

  it('throws when Evolution API credentials are invalid', async () => {
    (evo.validateInstanceCredentials as jest.Mock).mockResolvedValue(false);
    await expect(
      service.createEvolutionApiInstanceForUser('u1', 'guid', 'token', 'name'),
    ).rejects.toThrow(HttpException);
  });
});
