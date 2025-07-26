// src/evolution/evolution.service.ts
import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestConfig } from 'axios';

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {
    const rawUrl =
      this.configService.get<string>('EVOLUTION_API_URL') ||
      'https://evo.prixcenter.com';
    this.baseUrl = rawUrl.replace(/\/$/, '');
    // Log para confirmar que la URL base se está cargando correctamente al iniciar.
    this.logger.log(`EvolutionService initialized with baseUrl: [${this.baseUrl}]`);
  }

  /**
   * Helper privado para crear las cabeceras estándar para todas las peticiones.
   * Esto asegura que 'Content-Type' y 'apikey' se envíen siempre.
   * @param apiToken - El token de la instancia o el token global, según la operación.
   * @returns Un objeto de configuración de Axios con las cabeceras.
   */
  private _getConfig(apiToken: string): AxiosRequestConfig {
    return {
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiToken,
      },
    };
  }

  async sendMessage(
    instanceToken: string,
    instanceName: string,
    to: string,
    message: string,
  ) {
    const url = `${this.baseUrl}/message/sendText/${encodeURIComponent(
      instanceName,
    )}`;
    try {
      await lastValueFrom(
        this.http.post(
          url,
          {
            number: to,
            options: { delay: 1200, presence: 'composing' },
            textMessage: { text: message },
          },
          this._getConfig(instanceToken),
        ),
      );
    } catch (error) {
      this.logger.error(`Error sending message via Evolution API: ${error.message}`, error.stack);
      throw new HttpException('Error sending message via Evolution API', HttpStatus.BAD_REQUEST);
    }
  }

  async getInstanceStatus(instanceToken: string, instanceName: string) {
    const encodedName = encodeURIComponent(instanceName);
    const url = `${this.baseUrl}/instance/connectionState/${encodedName}`;
    try {
      const response = await lastValueFrom(
        this.http.get(url, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error checking instance status at /instance/connectionState/${instanceName}: ${error.message}`,
      );
      // ✅ CORREGIDO: Propagar el error original para que el método que llama pueda inspeccionarlo.
      throw error;
    }
  }

  async validateInstanceCredentials(
    instanceToken: string,
    instanceName: string,
  ): Promise<boolean> {
    try {
      const status = await this.getInstanceStatus(instanceToken, instanceName);
      if (status?.instance?.state) { // La respuesta correcta suele estar en `instance.state`
        this.logger.log(
          `✅ Instance ${instanceName} verified with state: ${status.instance.state}`,
        );
        return true;
      }
      this.logger.warn(`Instance ${instanceName} validation returned unexpected status: ${JSON.stringify(status)}`);
      return false;
    } catch (error: any) {
      // ✅ CORREGIDO: Log de depuración mejorado.
      // Esto registrará el código de estado (ej: 401, 404) y la respuesta del servidor.
      this.logger.error(
        `Axios error during validation for ${instanceName}: 
        Status: ${error.response?.status}, 
        Data: ${JSON.stringify(error.response?.data)}`,
        error.stack,
      );

      const message = error?.response?.data?.message || error.message;
      this.logger.warn(
        `❌ Failed to validate instance ${instanceName}: ${message}`,
      );
      return false;
    }
  }

  async createInstance(globalApiToken: string, instanceName: string) {
    const url = `${this.baseUrl}/instance/create`;
    try {
      const response = await lastValueFrom(
        this.http.post(
          url,
          // El cuerpo puede requerir más parámetros según la configuración de tu Evolution API
          { instanceName },
          this._getConfig(globalApiToken),
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Error creating instance via Evolution API: ${error.message}`,
        error.stack
      );
      throw new HttpException('Error creating instance', HttpStatus.BAD_REQUEST);
    }
  }

  async getQrCode(
    instanceToken: string,
    instanceName: string,
    number?: string,
  ): Promise<{ type: 'qr' | 'code'; data: string }> {
    const encodedName = encodeURIComponent(instanceName);
    let url = `${this.baseUrl}/instance/connect/${encodedName}`;
    if (number) url += `?number=${encodeURIComponent(number)}`;

    try {
      const response = await lastValueFrom(
        this.http.get(url, this._getConfig(instanceToken)),
      );

      const data = response.data || {};
      this.logger.debug(`QR response for ${instanceName}: ${JSON.stringify(data)}`);

      // Prioriza el QR en base64 si está disponible
      const qr = data.base64 || data.qr || data.qrCode;
      if (qr) return { type: 'qr', data: qr };

      // ✅ CORRECCIÓN: Accede a la propiedad 'code' dentro del objeto 'pairingCode'.
      const code = data.pairingCode?.code || data.code;
      if (code) return { type: 'code', data: code };

      throw new Error('QR code or pairing code not found in response');
    } catch (error) {
      this.logger.error(
        `Error fetching QR code for instance ${instanceName}: ${error.message}`,
        error.stack
      );
      throw new HttpException(
        'Failed to fetch QR code from Evolution API.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  async logoutInstance(instanceToken: string, instanceName: string) {
    const encodedName = encodeURIComponent(instanceName);
    const url = `${this.baseUrl}/instance/logout/${encodedName}`;
    try {
      await lastValueFrom(
        this.http.delete(url, this._getConfig(instanceToken)),
      );
      this.logger.log(`Successfully sent logout command to Evolution API for ${instanceName}.`);
    } catch (error) {
      this.logger.error(`Logout failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException(
        'Failed to logout instance on Evolution API.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteInstance(apiToken: string, instanceName: string) {
    const encodedName = encodeURIComponent(instanceName);
    const url = `${this.baseUrl}/instance/delete/${encodedName}`;
    try {
      await lastValueFrom(
        this.http.delete(url, this._getConfig(apiToken)),
      );
      this.logger.log(`Successfully sent delete command to Evolution API for ${instanceName}.`);
    } catch (error) {
      this.logger.error(`Delete failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to delete instance on Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async restartInstance(instanceToken: string, instanceName: string) {
    const encodedName = encodeURIComponent(instanceName);
    const url = `${this.baseUrl}/instance/restart/${encodedName}`;
    try {
      const response = await lastValueFrom(
        this.http.put(url, {}, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Restart failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to restart instance on Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async setPresence(
    instanceToken: string,
    instanceName: string,
    presence: string,
  ) {
    const url = `${this.baseUrl}/instance/setPresence/${encodeURIComponent(
      instanceName,
    )}`;
    try {
      await lastValueFrom(
        this.http.post(
          url,
          { presence },
          this._getConfig(instanceToken),
        ),
      );
    } catch (error) {
      this.logger.error(`Set presence failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to set presence on Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async setWebhook(
    instanceToken: string,
    instanceName: string,
    payload: any,
  ) {
    const url = `${this.baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`;
    try {
      const response = await lastValueFrom(
        this.http.post(url, payload, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Set webhook failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to set webhook on Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findWebhook(instanceToken: string, instanceName: string) {
    const url = `${this.baseUrl}/webhook/find/${encodeURIComponent(instanceName)}`;
    try {
      const response = await lastValueFrom(
        this.http.get(url, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Find webhook failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to get webhook from Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async setSettings(
    instanceToken: string,
    instanceName: string,
    settings: any,
  ) {
    const url = `${this.baseUrl}/settings/set/${encodeURIComponent(instanceName)}`;
    try {
      const response = await lastValueFrom(
        this.http.post(url, settings, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Set settings failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to set settings on Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findSettings(instanceToken: string, instanceName: string) {
    const url = `${this.baseUrl}/settings/find/${encodeURIComponent(instanceName)}`;
    try {
      const response = await lastValueFrom(
        this.http.get(url, this._getConfig(instanceToken)),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Find settings failed for ${instanceName}: ${error.message}`, error.stack);
      throw new HttpException('Failed to get settings from Evolution API.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

