import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
type Modules = Parameters<
  TestConvex<SchemaDefinition<GenericSchema, boolean>>["registerComponent"]
>[2];
declare global {
  interface ImportMeta {
    glob(patterns: string[]): Modules;
  }
}
const modules = import.meta.glob(["./component/**/*.ts", "!./component/**/*.test.ts"]);

export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "razorpay",
) {
  t.registerComponent(name, schema, modules);
}
