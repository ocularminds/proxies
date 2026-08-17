import config from './config';
import { createApp } from './app';
import { createLogStore } from './db';

const logStore = createLogStore(config.databaseUrl);
const app = createApp({ config, logStore });

app.listen(config.port, () => {
  console.log(`Proxies server listening on port ${config.port}`);
});
