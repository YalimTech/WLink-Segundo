import { Module, Logger } from '@nestjs/common';
import { CustomPageController } from './custom-page.controller';

@Module({
  controllers: [CustomPageController],
  providers: [Logger],
})
export class CustomPageModule {}
