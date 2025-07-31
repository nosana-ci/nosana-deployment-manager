import * as getRoutes from "./get/index.js";
import * as postRoutes from "./post/index.js";
import * as patchRoutes from "./patch/index.js";

export const routes = {
  get: getRoutes,
  post: postRoutes,
  patch: patchRoutes,
};
