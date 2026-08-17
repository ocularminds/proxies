import config from './config';
import { createApp } from './app';
import { createStores } from './stores';

const stores = createStores(config.databaseUrl);
if (!stores) {
  console.warn(
    `DATABASE_URL not set: identity endpoints disabled; validations are ${
      config.allowUnsignedValidation ? 'UNSIGNED (dev mode)' : 'rejected'
    }.`
  );
}

const app = createApp({ config, stores });

app.listen(config.port, () => {
  console.log(`Proxies server listening on port ${config.port}`);
});
