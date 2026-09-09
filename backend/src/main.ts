import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LocalAiWarmupService } from './modules/local-ai-warmup/local-ai-warmup.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  try {
    await app.get(LocalAiWarmupService).warmIfEnabled();
    await app.listen(process.env.PORT ?? 3000);
  } catch (error) {
    await app.close();
    throw error;
  }
}
void bootstrap();
