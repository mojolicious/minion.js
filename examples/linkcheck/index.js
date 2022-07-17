import {checkLinksTask} from './tasks/check-links.js';
import {minionPlugin} from '@minionjs/core';
import mojo, {yamlConfigPlugin} from '@mojojs/core';
import Pg from '@mojojs/pg';

export const app = mojo();
app.plugin(yamlConfigPlugin);
app.secrets = app.config.secrets;

app.addAppHook('app:start', async app => {
  if (app.models.pg === undefined) app.models.pg = new Pg(app.config.pg);
  app.plugin(minionPlugin, {config: app.models.pg});
  app.plugin(checkLinksTask);
});

app.get('/', ctx => ctx.redirectTo('index'));
app.get('/links').to('links#index').name('index');
app.post('/links').to('links#check').name('check');
app.get('/links/:id').to('links#result').name('result');

app.start();