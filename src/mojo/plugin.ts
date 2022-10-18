import type {MinionOptions} from '../minion.js';
import type {MojoApp} from '@mojojs/core';
import Minion from '../minion.js';
import Path from '@mojojs/path';

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
  app.models.minion = new Minion(options.config, {app, ...options});

  app.cli.commandPaths.push(Path.currentFile().sibling('cli').toString());

  if (options.autoUpdate ?? true === true) {
    app.addAppHook('app:start', async app => {
      await app.models.minion.update();
    });
  }
}
