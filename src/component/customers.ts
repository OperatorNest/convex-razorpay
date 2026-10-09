import { razorpayError } from "../shared/errors.js";
import { v } from "convex/values";
import { action, query } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";
import type { ActionCtx } from "./_generated/server.js";
import { assertModeMatches, isTestMode, requestProvider } from "./provider.js";
import { deterministicTestId, linkedNotes, omitUndefined, record } from "../shared/validation.js";
import { linkArgs, notesArg, validateIdempotencyKey } from "./validators.js";
import { optionalLinkage } from "./validators.js";

const createArgs = {
  name: v.string(),
  email: v.string(),
  contact: v.optional(v.string()),
  gstin: v.optional(v.string()),
  notes: notesArg,
  ...linkArgs,
};

function validateCustomerName(name: string): void {
  if (name.length < 3 || name.length > 50)
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid customer name");
}

function validateCustomerEmail(email: string): void {
  if (email.length > 64 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid customer email");
}

function validateCustomerContact(contact: string): void {
  if (contact.length > 15 || !/^\+?[0-9]{8,15}$/.test(contact))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid customer contact");
}

function validateCustomer(name: string, email: string, contact?: string): void {
  validateCustomerName(name);
  validateCustomerEmail(email);
  if (contact !== undefined) validateCustomerContact(contact);
}

async function refreshCustomerProfile(
  ctx: ActionCtx,
  linked: Doc<"customers">,
  args: {
    name: string;
    email: string;
    contact?: string;
    userId?: string;
    externalId?: string;
    metadata?: Record<string, string>;
  },
  testMode: boolean,
): Promise<Doc<"customers">> {
  const changes = {
    name: linked.name !== args.name ? args.name : undefined,
    email: linked.email !== args.email ? args.email : undefined,
    contact: linked.contact !== args.contact ? args.contact : undefined,
  };
  if (!changes.name && !changes.email && !changes.contact) return linked;
  let updated: unknown;
  if (testMode) {
    updated = omitUndefined({
      ...linked.raw,
      id: linked.razorpayId,
      name: args.name,
      email: args.email,
      contact: args.contact ?? linked.contact,
      created_at: Math.floor(linked.createdAt / 1000),
    });
  } else {
    updated = await requestProvider("PUT", `/customers/${encodeURIComponent(linked.razorpayId)}`, {
      body: { ...changes, contact: args.contact ?? linked.contact },
    });
    if (record(updated).id !== linked.razorpayId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay customer id mismatch");
    const provider = record(updated);
    if (provider.contact === undefined && linked.contact !== undefined) {
      updated = { ...provider, contact: linked.contact };
    }
  }
  return ctx.runMutation(internal.mutations.putCustomer, {
    raw: omitUndefined(updated),
    observedAt: Date.now(),
    ...optionalLinkage({
      userId: args.userId,
      externalId: args.externalId,
      metadata: args.metadata,
      testMode,
    }),
  });
}

async function createCustomer(
  ctx: ActionCtx,
  args: {
    name: string;
    email: string;
    contact?: string;
    gstin?: string;
    notes?: Record<string, string>;
    userId?: string;
    externalId?: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    testMode?: boolean;
  },
  getOrCreate: boolean,
): Promise<Doc<"customers">> {
  const testMode = isTestMode(args.testMode);
  validateCustomer(args.name, args.email, args.contact);
  validateIdempotencyKey(args.idempotencyKey);
  if (args.gstin && !/^[0-9A-Z]{15}$/.test(args.gstin))
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Invalid customer GSTIN");
  const existing = args.idempotencyKey
    ? await ctx.runQuery(internal.mutations.customerByKey, { key: args.idempotencyKey })
    : null;
  if (existing) {
    assertModeMatches(existing, testMode, "customer");
    if (getOrCreate && args.userId && existing.userId && existing.userId !== args.userId) {
      throw razorpayError(
        "RAZORPAY_CUSTOMER_CONFLICT",
        "Razorpay customer is linked to another user",
      );
    }
    if (getOrCreate && args.userId) {
      return refreshCustomerProfile(ctx, existing, args, testMode);
    }
    if (
      existing.name !== args.name ||
      existing.email !== args.email ||
      existing.contact !== args.contact
    )
      throw razorpayError(
        "RAZORPAY_IDEMPOTENCY_CONFLICT",
        "Idempotency key reused with different customer",
      );
    return existing;
  }
  if (getOrCreate && args.userId) {
    const linked = await ctx.runQuery(internal.mutations.customerByUser, { userId: args.userId });
    if (linked) {
      assertModeMatches(linked, testMode, "customer");
      if (linked.userId && linked.userId !== args.userId) {
        throw razorpayError(
          "RAZORPAY_CUSTOMER_CONFLICT",
          "Razorpay customer is linked to another user",
        );
      }
      return refreshCustomerProfile(ctx, linked, args, testMode);
    }
  }
  const notes = linkedNotes(args.notes, args.userId, args.externalId, args.metadata);
  const raw = testMode
    ? {
        id: await deterministicTestId("cust", [args.idempotencyKey ?? args.email, args.contact]),
        entity: "customer",
        name: args.name,
        email: args.email,
        contact: args.contact,
        gstin: args.gstin,
        notes,
        created_at: Math.floor(Date.now() / 1000),
      }
    : await requestProvider("POST", "/customers", {
        body: {
          name: args.name,
          email: args.email,
          contact: args.contact,
          gstin: args.gstin,
          notes,
          fail_existing: getOrCreate ? "0" : "1",
        },
      });
  return ctx.runMutation(internal.mutations.putCustomer, {
    raw: omitUndefined(raw),
    observedAt: Date.now(),
    ...optionalLinkage({
      userId: args.userId,
      externalId: args.externalId,
      metadata: args.metadata,
      idempotencyKey: args.idempotencyKey,
      testMode,
    }),
  });
}

export const create = action({
  args: createArgs,
  returns: schema.doc("customers"),
  handler: (ctx, args) => createCustomer(ctx, args, false),
});
export const getOrCreate = action({
  args: createArgs,
  returns: schema.doc("customers"),
  handler: (ctx, args) => createCustomer(ctx, args, true),
});

export const fetch = action({
  args: { customerId: v.string(), testMode: v.optional(v.boolean()) },
  returns: schema.doc("customers"),
  handler: async (ctx, { customerId, testMode }): Promise<Doc<"customers">> => {
    if (isTestMode(testMode)) {
      const local = await ctx.runQuery(internal.lookup.customer, { id: customerId });
      if (!local) throw razorpayError("RAZORPAY_NOT_FOUND", "Customer not found in test mode");
      assertModeMatches(local, true, "customer");
      return local;
    }
    const raw = await requestProvider("GET", `/customers/${encodeURIComponent(customerId)}`, {
      idempotent: true,
    });
    if (record(raw).id !== customerId)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay customer id mismatch");
    return ctx.runMutation(internal.mutations.putCustomer, {
      raw: omitUndefined(raw),
      observedAt: Date.now(),
    });
  },
});

export const edit = action({
  args: {
    customerId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    contact: v.optional(v.string()),
    testMode: v.optional(v.boolean()),
  },
  returns: schema.doc("customers"),
  handler: async (ctx, args): Promise<Doc<"customers">> => {
    if (!args.name && !args.email && !args.contact)
      throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Customer edit requires a field");
    const existing = await ctx.runQuery(internal.lookup.customer, { id: args.customerId });
    if (args.name !== undefined) validateCustomerName(args.name);
    if (args.email !== undefined) validateCustomerEmail(args.email);
    if (args.contact !== undefined) validateCustomerContact(args.contact);
    const testMode = isTestMode(args.testMode);
    if (existing) assertModeMatches(existing, testMode, "customer");
    let raw: unknown;
    if (testMode) {
      if (!existing) throw razorpayError("RAZORPAY_NOT_FOUND", "Customer not found in test mode");
      raw = {
        ...existing.raw,
        id: args.customerId,
        name: args.name ?? existing.name,
        email: args.email ?? existing.email,
        contact: args.contact ?? existing.contact,
        created_at: Math.floor(existing.createdAt / 1000),
      };
    } else {
      raw = await requestProvider("PUT", `/customers/${encodeURIComponent(args.customerId)}`, {
        body: { name: args.name, email: args.email, contact: args.contact },
      });
      if (record(raw).id !== args.customerId)
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT", "Razorpay customer id mismatch");
    }
    return ctx.runMutation(internal.mutations.putCustomer, {
      raw: omitUndefined(raw),
      observedAt: Date.now(),
      testMode,
    });
  },
});

export const getByUser = query({
  args: { userId: v.string() },
  returns: v.union(schema.doc("customers"), v.null()),
  handler: (ctx, { userId }) =>
    ctx.db
      .query("customers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first(),
});
