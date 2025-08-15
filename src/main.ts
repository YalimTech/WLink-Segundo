import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';

// --- INICIO DE LA CORRECCIÓN ---
// Soluciona el error de serialización de BigInt en las respuestas JSON.
// Esto le dice a JSON.stringify que convierta cualquier BigInt a un string.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
// --- FIN DE LA CORRECCIÓN ---

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {});

  // --- Tu configuración existente ---
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  // Permitir que la app se embeba dentro de GHL y cargar recursos externos
  app.use(
    helmet({
      frameguard: false, // No forzar SAMEORIGIN
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'", 'https:', 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:', 'http:', 'data:'],
          frameAncestors: ['*'],
          frameSrc: ['*'],
          objectSrc: ["'none'"],
        },
      },
    }),
  );
  app.enableShutdownHooks();
  // --- Fin de tu configuración ---

  // Habilitar CORS para permitir peticiones desde el frontend.
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`Application is running on: http://${host === '::' ? '[::]' : host}:${port}`);
}
void bootstrap();


