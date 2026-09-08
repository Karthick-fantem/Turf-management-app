import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TurfsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.turf.findMany({
      include: {
        grounds: true,
      },
    });
  }

  async findOne(id: string) {
    const turf = await this.prisma.turf.findUnique({
      where: { id },
      include: {
        grounds: true,
      },
    });

    if (!turf) {
      throw new NotFoundException(`Turf with ID ${id} not found`);
    }

    return turf;
  }
}
