export function checkLinksTask(app) {
  app.models.minion.addTask('checkLinks', checkLinks);
}

async function checkLinks(job, url) {
  const ua = job.app.ua;
  const res = await ua.get(url);
  const results = [[url, res.statusCode]];

  const dom = await res.html();
  const links = dom.find('a[href]').map(el => el.attr.href);
  for (const link of links) {
    const abs = new URL(link, url);
    const res = await ua.head(abs);
    results.push([link, res.statusCode]);
  }

  await job.finish(results);
}
