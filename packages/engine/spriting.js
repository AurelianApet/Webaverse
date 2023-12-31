import {createObjectSpriteSheet} from './object-spriter.js';
import metaversefile from './metaversefile-api.js';

export async function createAppUrlSpriteSheet(appUrl, opts) {
  const app = await metaversefile.createAppAsync({
    start_url: appUrl,
    components: [
      {
        key: 'physics',
        value: true,
      },
    ],
  });
  const spritesheet = await createObjectSpriteSheet(app, opts);
  app.destroy();
  return spritesheet;
}