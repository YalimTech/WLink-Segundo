import { Module, Logger } from "@nestjs/common";
import { EvolutionApiService } from "./evolution-api.service";
import { EvolutionApiTransformer } from "./evolution-api.transformer";
import { EvolutionApiController } from './evolution-api.controller';
import { QrController } from './qr.controller';
import { EvolutionModule } from '../evolution/evolution.module';

@Module({
        imports: [EvolutionModule],
        providers: [Logger, EvolutionApiService, EvolutionApiTransformer],
        exports: [EvolutionApiService, EvolutionApiTransformer],
        controllers: [EvolutionApiController, QrController],
})
export class EvolutionApiModule {}
