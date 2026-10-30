import { Global, Module } from '@nestjs/common';
import { envProvider } from './env';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [envProvider, PrismaService], exports: [envProvider, PrismaService] })
export class CommonModule {}
