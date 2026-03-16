import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

@Injectable()
export class FileStoreService {
  private readonly dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');

  async readJson<T>(fileName: string, fallback: T): Promise<T> {
    await mkdir(this.dataDir, { recursive: true });

    const fullPath = join(this.dataDir, fileName);

    try {
      const raw = await readFile(fullPath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      await this.writeJson(fileName, fallback);
      return fallback;
    }
  }

  async writeJson<T>(fileName: string, value: T): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const fullPath = join(this.dataDir, fileName);
    await writeFile(fullPath, JSON.stringify(value, null, 2), 'utf8');
  }
}
