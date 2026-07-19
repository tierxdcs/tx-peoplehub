import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { PrismaService } from './core/database/prisma.service';

async function bootstrap() {
  // First line of output — if THIS doesn't appear in the deploy logs, the
  // process died before bootstrap even ran (an import-time throw), not here.
  // eslint-disable-next-line no-console
  console.log(`Booting tx-peoplehub API (PORT=${process.env.PORT ?? '3000'})`);

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);

  // Parse cookies (refresh-token cookie for the auth flow).
  app.use(cookieParser());
  // Finance statement CSVs are submitted as UTF-8 text inside JSON. Keep a
  // bounded 5 MB limit rather than Express's 100 KB default.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // Validate + transform all incoming DTOs; strip unknown properties.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS locked to the Next.js frontend origin; allow credentials for cookie.
  app.enableCors({
    origin: config.get<string>('frontendOrigin'),
    credentials: true,
  });

  // Close Prisma cleanly on shutdown.
  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  // OpenAPI docs at /docs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('tx-peoplehub ERP API')
    .setDescription('Modular ERP backend — foundation phase')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('port') ?? 3000;
  // Bind to 0.0.0.0 (all interfaces), not the Nest default of localhost —
  // Railway/containers route external traffic to the container's public
  // interface, and a localhost-only bind would pass health checks never.
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`tx-peoplehub API listening on port ${port}`);
}

// A rejection anywhere in bootstrap() (Joi env-validation failure, a provider
// that throws during DI, a bad DB connect) must surface with a full stack and
// a non-zero exit — otherwise Node exits 0 silently and the platform just sees
// "process gone, health check failing" with no clue why. This is exactly the
// failure mode that produced silent post-migration crashes on Railway.
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL: application failed to start');
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
