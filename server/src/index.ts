import { readFileSync } from 'node:fs';
import https from 'node:https';
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

if (config.tlsCertPath && config.tlsKeyPath) {
  const server = https.createServer(
    { cert: readFileSync(config.tlsCertPath), key: readFileSync(config.tlsKeyPath) },
    app
  );
  server.listen(config.port, () => {
    console.log(`Proxies server listening on port ${config.port} (TLS)`);
  });
} else {
  console.warn('TLS not configured: serving plain HTTP. Use TLS or a terminating proxy in production.');
  app.listen(config.port, () => {
    console.log(`Proxies server listening on port ${config.port}`);
  });
}
