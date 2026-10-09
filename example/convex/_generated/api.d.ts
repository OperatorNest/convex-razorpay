/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as e2e from "../e2e.js";
import type * as example from "../example.js";
import type * as http from "../http.js";
import type * as smoke from "../smoke.js";
import type * as webhookCallback from "../webhookCallback.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  e2e: typeof e2e;
  example: typeof example;
  http: typeof http;
  smoke: typeof smoke;
  webhookCallback: typeof webhookCallback;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  razorpay: import("@operatornest/convex-razorpay/_generated/component.js").ComponentApi<"razorpay">;
};
