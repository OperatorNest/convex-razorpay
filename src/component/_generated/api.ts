/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as idempotency from "../idempotency.js";
import type * as lookup from "../lookup.js";
import type * as mapping from "../mapping.js";
import type * as mutations from "../mutations.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as plans from "../plans.js";
import type * as provider from "../provider.js";
import type * as refunds from "../refunds.js";
import type * as subscriptions from "../subscriptions.js";
import type * as validators from "../validators.js";
import type * as verification from "../verification.js";
import type * as webhooks from "../webhooks.js";
import type * as write from "../write.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  crons: typeof crons;
  customers: typeof customers;
  idempotency: typeof idempotency;
  lookup: typeof lookup;
  mapping: typeof mapping;
  mutations: typeof mutations;
  orders: typeof orders;
  payments: typeof payments;
  plans: typeof plans;
  provider: typeof provider;
  refunds: typeof refunds;
  subscriptions: typeof subscriptions;
  validators: typeof validators;
  verification: typeof verification;
  webhooks: typeof webhooks;
  write: typeof write;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
