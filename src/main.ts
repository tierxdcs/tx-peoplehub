import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaService } from './core/database/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Parse cookies (refresh-token cookie for the auth flow).
  app.use(cookieParser());

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
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`tx-peoplehub API listening on http://localhost:${port}`);
}

void bootstrap();
