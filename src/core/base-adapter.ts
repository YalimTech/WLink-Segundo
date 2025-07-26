// src/core/base-adapter.ts

import { MessageTransformer, StorageProvider, NotFoundError, IntegrationError } from '../evolutionapi';
import { Logger } from '@nestjs/common';

export { MessageTransformer, StorageProvider, NotFoundError, IntegrationError };

export abstract class BaseAdapter<T, U, V, W> {
  constructor(
    protected readonly transformer: MessageTransformer<T, U>,
    protected readonly storage: StorageProvider<V, W, any, any>,
    protected readonly logger: Logger,
  ) {}
}
