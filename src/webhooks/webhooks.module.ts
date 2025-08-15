import { Module, Logger } from "@nestjs/common";
import { ConfigModule } from '@nestjs/config';
import { WebhooksController } from "./webhooks.controller";
import { EvolutionApiModule } from "../evolution-api/evolution-api.module";
import { DynamicInstanceGuard } from './guards/dynamic-instance.guard';

@Module({
        imports: [ConfigModule, EvolutionApiModule],
        controllers: [WebhooksController],
        providers: [DynamicInstanceGuard, Logger],
})
export class WebhooksModule {}
