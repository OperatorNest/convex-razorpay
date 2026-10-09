import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
import type { ImportMetaGlob } from "./import-meta.js";

const modules: ReturnType<ImportMetaGlob> = import.meta.glob([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
]);

export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "razorpay",
) {
  t.registerComponent(name, schema, modules);
}
