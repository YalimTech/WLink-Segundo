//src/evolution-api/guards/ghl-context.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CryptoJS from 'crypto-js';
import { GhlUserData } from '../../types';

@Injectable()
export class GhlContextGuard implements CanActivate {
  private readonly logger = new Logger(GhlContextGuard.name);

  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const encryptedData = request.headers['x-ghl-context'];

    if (!encryptedData) {
      throw new UnauthorizedException('No GHL context provided');
    }

    try {
      const sharedSecret = this.configService.get<string>('GHL_SHARED_SECRET')!;
      const decrypted = CryptoJS.AES.decrypt(
        encryptedData,
        sharedSecret,
      ).toString(CryptoJS.enc.Utf8);

      if (!decrypted) {
        this.logger.warn(
          'GHL context decryption failed. Check your GHL_SHARED_SECRET.',
        );
        throw new UnauthorizedException('Invalid GHL context');
      }

      const userData: GhlUserData = JSON.parse(decrypted);

      // ✅ --- CORRECCIÓN FINAL Y DEFINITIVA ---
      // Se utiliza la propiedad correcta `activeLocation` que envía GHL.
      // Esto soluciona el error "No active location ID in user context".
      const locationId = userData.activeLocation;

      if (!locationId) {
        this.logger.warn({
          message: 'No activeLocation property found in decrypted GHL payload.',
          decryptedPayload: userData,
        });
        throw new UnauthorizedException('No active location ID in user context');
      }

      // Se adjunta el locationId a la petición, como lo hacía tu código original.
      // Esto asegura la compatibilidad con el resto de tu aplicación.
      request.locationId = locationId;
      return true;
    } catch (error) {
      this.logger.error('Error processing GHL context', error.stack);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or malformed GHL context');
    }
  }
}

