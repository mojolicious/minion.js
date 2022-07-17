export default class PostsController {
  async check(ctx) {
    const params = await ctx.params();
    const id = await ctx.models.minion.enqueue('checkLinks', [params.get('url')]);
    await ctx.redirectTo('result', {values: {id}});
  }

  async index(ctx) {
    await ctx.render();
  }

  async result(ctx) {
    const job = await ctx.models.minion.job(ctx.stash.id);
    if (job === null) return await ctx.notFound();
    const {result} = await job.info();
    await ctx.render({view: 'links/result'}, {result});
  }
}
