import type {MinionOptions} from './minion.js';
import type {MojoApp} from '@mojojs/core';
import Minion from './minion.js';

interface PluginOptions extends MinionOptions {
  autoUpdate?: boolean;
  config: any;
}

declare module '@mojojs/core' {
  interface MojoModels {
    minion: Minion;
  }
}

export function minionPlugin(app: MojoApp, options: PluginOptions): void {
  app.models.minion = new Minion(options.config, options);

  if (options.autoUpdate ?? true === true) {
    app.addAppHook('app:start', async app => {
      await app.models.minion.update();
    });
  }
}
