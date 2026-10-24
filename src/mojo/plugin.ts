import type {MojoApp} from '@mojojs/core';
import Minion, {type MinionOptions} from '../minion.ts';
import Path from '@mojojs/path';

interface PluginOptions extends MinionOptions {
  autoUpdate?: boolean;
  config?: any;
}

declare module '@mojojs/core' {
  interface MojoModels {
    minion: Minion;
  }
}

export function minionPlugin(app: MojoApp, options: PluginOptions): void {
  app.models.minion = new Minion(options.config, {app, ...options});

  app.cli.commandPaths.push(Path.currentFile().sibling('cli').toString());

  if ((options.autoUpdate ?? true) === true) {
    app.onStart(async app => {
      await app.models.minion.update();
    });
  }
}
