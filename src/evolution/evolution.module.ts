import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EvolutionService } from './evolution.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class EvolutionModule {}
