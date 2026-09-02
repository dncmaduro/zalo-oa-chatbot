import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

@Injectable()
export class ImportStorageService {
  async saveSourceWorkbook(batchId: string, file: Express.Multer.File): Promise<string> {
    const sourceWorkbookPath = this.getSourceWorkbookPath(batchId);

    await mkdir(resolve(sourceWorkbookPath, '..'), { recursive: true });

    await writeFile(sourceWorkbookPath, file.buffer);

    return sourceWorkbookPath;
  }

  getSourceWorkbookPath(batchId: string): string {
    const storageRoot = process.env.IMPORT_STORAGE_PATH;

    if (!storageRoot) {
      throw new Error('IMPORT_STORAGE_PATH environment variable is required');
    }

    return join(resolve(storageRoot), batchId, 'source.xlsx');
  }
}
