import { readFileSync } from 'node:fs';
import https from 'node:https';
import config from './config';
import { createApp } from './app';
import { createStores } from './stores';
import { startMqttBridge } from './mqtt';
import { defaultNotifier } from './notify';

const stores = createStores(config.databaseUrl);
if (!stores) {
  console.warn(
    `DATABASE_URL not set: identity endpoints disabled; validations are ${
      config.allowUnsignedValidation ? 'UNSIGNED (dev mode)' : 'rejected'
    }.`
  );
}

const app = createApp({ config, stores });

if (config.mqttUrl) {
  if (!stores) {
    console.warn('MQTT_URL set but no database configured; bridge not started.');
  } else {
    startMqttBridge(
      config.mqttUrl,
      { username: config.mqttUsername, password: config.mqttPassword },
      {
        config: { timestampToleranceMs: config.timestampToleranceMs },
        stores,
        notifier: defaultNotifier,
      }
    );
    console.log(`MQTT bridge connecting to ${config.mqttUrl}`);
  }
}

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
