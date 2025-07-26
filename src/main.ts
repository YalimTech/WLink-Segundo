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
  app.use(helmet());
  app.enableShutdownHooks();
  // --- Fin de tu configuración ---

  // Habilitar CORS para permitir peticiones desde el frontend.
  app.enableCors({
    origin: '*', // Puedes restringirlo a dominios específicos en producción
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
void bootstrap();


