import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EvolutionApiModule } from './evolution-api/evolution-api.module';
import { OauthModule } from './oauth/oauth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomPageModule } from './custom-page/custom-page.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true, envFilePath: '.env', cache: true,
        }),
        PrismaModule,
        EvolutionApiModule,
        OauthModule,
        WebhooksModule,
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
        CustomPageModule,
    ],
})
export class AppModule {}
