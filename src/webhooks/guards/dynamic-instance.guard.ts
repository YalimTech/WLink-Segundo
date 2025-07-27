//src/webhooks/guards/dynamic-instance.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';
import { EvolutionWebhook } from '../../types';
import * as crypto from 'crypto';

@Injectable()
export class DynamicInstanceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = request.body as EvolutionWebhook | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    // payload.instance es el 'instanceName' de Evolution API según tu modelo EvolutionWebhook
    if (!payload?.instance) {
      throw new UnauthorizedException('Missing instance name in webhook payload'); // Mensaje de error más específico
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // Busca la instancia por su 'instanceName' (que viene en payload.instance)
    // El método `getInstance` de PrismaService ya fue actualizado para esperar 'instanceName'.
    const instance = await this.prisma.getInstance(payload.instance); 
    if (!instance) {
      throw new UnauthorizedException('Instance not found');
    }

    const provided = Buffer.from(token);
    const expected = Buffer.from(instance.apiTokenInstance);

    const valid =
      provided.length === expected.length &&
      crypto.timingSafeEqual(provided, expected);

    if (!valid) {
      throw new UnauthorizedException('Invalid token');
    }

    return true;
  }
}
