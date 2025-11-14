import { createApplication } from './app.js';

const { app, config } = createApplication();
const disableListener = process.env.ARTIFACT_PUBLISHER_DISABLE_LISTENER === '1';

if (disableListener) {
  console.warn('ArtifactPublisher listener disabled via ARTIFACT_PUBLISHER_DISABLE_LISTENER=1');
} else {
  app.listen(config.port, () => {
    console.log(`ArtifactPublisher server listening on ${config.port}`);
  });
}
