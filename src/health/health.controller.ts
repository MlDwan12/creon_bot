import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Жив ли сервис: процесс отвечает и база доступна. Без авторизации — его дёргает HEALTHCHECK
 * из Dockerfile (статус healthy/unhealthy в `docker ps`) и может дёргать мониторинг.
 */
@Controller('api/health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('База недоступна');
    }
    return { ok: true };
  }
}
