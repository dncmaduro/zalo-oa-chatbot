import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';

import { KnowledgeEmbeddingBackfillService } from './knowledge-embedding-backfill.service';

async function main(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);

  try {
    const service = application.get(KnowledgeEmbeddingBackfillService);
    const result = await service.backfill();

    console.log(JSON.stringify(result));
  } finally {
    await application.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
