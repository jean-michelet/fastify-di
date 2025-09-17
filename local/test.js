import fastify from "fastify";
import fastifyPlugin from "fastify-plugin";

const app = fastify();

app.register(async (instance) => {
  instance.register(
    fastifyPlugin(async (child) => {
      child.decorate("x", true);
      child.register(
        fastifyPlugin(async (grandchild) => {
          grandchild.decorate("y", true);
        }),
      );
    }),
  );

  instance.register(
    fastifyPlugin(async (child) => {
      console.log("child", child.x);
      console.log("grandchild", child.y);
    }),
  );
});

await app.ready();
