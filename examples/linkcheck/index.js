import {checkLinksTask} from './tasks/check-links.js';
//import {minionPlugin, minionAdminPlugin} from '@minionjs/core';
import {minionPlugin, minionAdminPlugin} from '../../lib/minion.js';
import mojo, {yamlConfigPlugin} from '@mojojs/core';
import Pg from '@mojojs/pg';

export const app = mojo();
app.plugin(yamlConfigPlugin);
app.plugin(minionAdminPlugin);
app.secrets = app.config.secrets;

app.onStart(async app => {
  if (app.models.pg === undefined) app.models.pg = new Pg(app.config.pg);
  app.plugin(minionPlugin, {config: app.models.pg});
  app.plugin(checkLinksTask);
});

app.get('/', ctx => ctx.redirectTo('index'));
app.get('/links').to('links#index').name('index');
app.post('/links').to('links#check').name('check');
app.get('/links/:id').to('links#result').name('result');

app.start();
