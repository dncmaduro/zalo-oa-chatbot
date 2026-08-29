import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHello() {
    const roles = await this.prisma.role.findMany();

    return {
      message: 'DB connected',
      roles,
    };
  }
}