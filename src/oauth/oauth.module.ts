import { Module, Logger } from "@nestjs/common";
import { GhlOauthController } from "./oauth.controller";
import { ConfigModule } from "@nestjs/config";
import { EvolutionModule } from "../evolution/evolution.module";
import { EvolutionApiModule } from "../evolution-api/evolution-api.module";

@Module({
  imports: [ConfigModule, EvolutionModule, EvolutionApiModule],
  controllers: [GhlOauthController],
  providers: [Logger],
})
export class OauthModule {}


