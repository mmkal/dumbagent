/// <reference path="./node_modules/bun-types/index.d.ts" />

declare module "*.html" {
  const content: Response;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

