export type {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  SubscriptionStatus,
  PaymentRefundStatus,
  WebhookStatus,
  IdempotencyStatus,
  PaymentLinkStatus,
} from "../shared/statuses.js";
import {
  createFunctionHandle,
  httpActionGeneric,
  type FunctionArgs,
  type FunctionReference_future,
  type GenericActionCtx,
  type GenericQueryCtx,
  type GenericMutationCtx,
  type GenericDataModel,
  type HttpRouter,
} from "convex/server";
import type { Infer } from "convex/values";
import { webhookEventValidator } from "../shared/validators.js";
import type { ComponentApi } from "../component/_generated/component.js";
import { isRazorpayError } from "../shared/errors.js";
import { validateNotes } from "../shared/validation.js";

import { maxWebhookBodyBytes } from "../shared/constants.js";
import { readBoundedText } from "../shared/bounds.js";

export { RAZORPAY_ERROR_CODES, isRazorpayError } from "../shared/errors.js";
export type { RazorpayErrorCode, RazorpayErrorData } from "../shared/errors.js";
export { computeSha256Hex, computeHmacSha256Hex, compareHexSignatures } from "../shared/crypto.js";
export { webhookEventValidator } from "../shared/validators.js";

// shared-block:begin
/** Runs component queries; app queries, mutations and actions provide it. */
export type QueryContext = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
/** Runs component mutations; app mutations and actions provide it. */
export type MutationContext = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
/** Runs component actions; app actions provide it. */
export type ActionContext = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
// shared-block:end

/** Describes a verified Razorpay event delivered to the app callback. */
export type RazorpayWebhookEventArgs = Infer<typeof webhookEventValidator>;
type EventCallback = FunctionReference_future<
  "mutation",
  "internal",
  RazorpayWebhookEventArgs,
  null
>;

/** Selects test operations and the internal event callback. */
export type RazorpayOptions = {
  testMode?: boolean;
  onEvent?: EventCallback;
};

/** Describes the options passed to Razorpay Checkout.js. */
export type CheckoutOptions = {
  key?: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string; backdrop_color?: string };
};

/** Builds Razorpay Checkout options from a provider order and presentation fields. */
export function buildCheckoutOptions(
  order: { razorpayOrderId: string; amount: number; currency: string; keyId?: string | undefined },
  options?: Omit<CheckoutOptions, "key" | "order_id" | "amount" | "currency">,
): CheckoutOptions {
  return {
    key: order.keyId,
    order_id: order.razorpayOrderId,
    amount: order.amount,
    currency: order.currency,
    name: options?.name,
    description: options?.description,
    prefill: options?.prefill,
    notes: options?.notes,
    theme: options?.theme,
  };
}

function exposeRow<
  T extends { _id: string; _creationTime: number },
  K extends Record<string, string>,
>(row: T, identify: (rowId: T["_id"]) => K) {
  const { _id, _creationTime, ...fields } = row;
  return { ...fields, ...identify(_id) };
}

/** Provides aggregate operations for Razorpay resources and stored mirrors. */
export class Razorpay {
  /** Creates a client for the mounted component; `options` selects test mode and the event callback. */
  constructor(
    private readonly component: ComponentApi,
    private readonly options: RazorpayOptions = {},
  ) {}

  /** Creates and reads Razorpay orders and verifies their Checkout payments. */
  readonly orders = {
    /** Creates an order and stores its mirror. */
    create: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["create"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        amount: args.amount,
        currency: args.currency,
        receipt: args.receipt,
        notes: args.notes,
        partialPayment: args.partialPayment,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.orders.create, componentArgs)
        .then(({ order, keyId }) => ({
          ...exposeRow(order, (orderId) => ({ orderId })),
          keyId,
        }));
    },
    /** Fetches an order without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.orders.fetch, componentArgs);
    },
    /** Fetches payments for a Razorpay order without storing responses. */
    fetchPayments: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetchPayments"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.orders.fetchPayments, componentArgs);
    },
    /** Reads a stored order in the selected test mode. */
    get: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["get"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        testMode: this.options.testMode,
      };
      return ctx
        .runQuery(this.component.orders.get, componentArgs)
        .then((row) => (row === null ? null : exposeRow(row, (orderId) => ({ orderId }))));
    },
    /** Verifies the order Checkout signature and payment relationship. */
    verifyCheckout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["verifyCheckout"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        razorpayPaymentId: args.razorpayPaymentId,
        signature: args.signature,
        userId: args.userId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.orders.verifyCheckout, componentArgs)
        .then((row) => exposeRow(row, (paymentId) => ({ paymentId })));
    },
    /** Releases an unresolved order claim after the app establishes its provider outcome. */
    releaseIdempotency: (
      ctx: MutationContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["releaseIdempotency"]>, "testMode">,
    ) =>
      ctx.runMutation(this.component.orders.releaseIdempotency, {
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Reads, lists and captures Razorpay payments. */
  readonly payments = {
    /** Fetches a payment without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPaymentId: args.razorpayPaymentId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.payments.fetch, componentArgs);
    },
    /** Captures an authorized payment and stores its mirror. */
    capture: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["capture"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPaymentId: args.razorpayPaymentId,
        amount: args.amount,
        currency: args.currency,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.payments.capture, componentArgs)
        .then((row) => exposeRow(row, (paymentId) => ({ paymentId })));
    },
    /** Fetches a provider page of payments without storing responses. */
    fetchAll: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["fetchAll"]>, "testMode">,
    ) => {
      const componentArgs = {
        count: args.count,
        skip: args.skip,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.payments.fetchAll, componentArgs);
    },
    /** Reads a bounded page of stored payments. */
    list: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["list"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: args.paginationOpts.cursor,
          endCursor: args.paginationOpts.endCursor,
        },
        testMode: this.options.testMode,
      };
      return ctx.runQuery(this.component.payments.list, componentArgs).then((result) => ({
        ...result,
        page: result.page.map((row) => exposeRow(row, (paymentId) => ({ paymentId }))),
      }));
    },
  };

  /** Creates and reads Razorpay refunds. */
  readonly refunds = {
    /** Creates a refund and stores its mirror. */
    create: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["create"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        razorpayPaymentId: args.razorpayPaymentId,
        amount: args.amount,
        speed: args.speed,
        receipt: args.receipt,
        notes: args.notes,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.refunds.create, componentArgs)
        .then((row) => exposeRow(row, (refundId) => ({ refundId })));
    },
    /** Fetches a refund without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayRefundId: args.razorpayRefundId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.refunds.fetch, componentArgs);
    },
  };

  /** Creates, reads and edits Razorpay customers. */
  readonly customers = {
    /** Creates a customer and stores its mirror. */
    create: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["create"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        name: args.name,
        email: args.email,
        contact: args.contact,
        gstin: args.gstin,
        notes: args.notes,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.customers.create, componentArgs)
        .then((row) => exposeRow(row, (customerId) => ({ customerId })));
    },
    /** Returns or creates a customer linked to the requested app user. */
    getOrCreate: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["getOrCreate"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        name: args.name,
        email: args.email,
        contact: args.contact,
        gstin: args.gstin,
        notes: args.notes,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.customers.getOrCreate, componentArgs)
        .then((row) => exposeRow(row, (customerId) => ({ customerId })));
    },
    /** Fetches a customer without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayCustomerId: args.razorpayCustomerId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.customers.fetch, componentArgs);
    },
    /** Edits a customer profile and stores its mirror. */
    edit: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["edit"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayCustomerId: args.razorpayCustomerId,
        name: args.name,
        email: args.email,
        contact: args.contact,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.customers.edit, componentArgs)
        .then((row) => exposeRow(row, (customerId) => ({ customerId })));
    },
    /** Reads a stored customer in the selected test mode. */
    get: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["get"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        testMode: this.options.testMode,
      };
      return ctx
        .runQuery(this.component.customers.get, componentArgs)
        .then((row) => (row === null ? null : exposeRow(row, (customerId) => ({ customerId }))));
    },
    /** Releases an unresolved customer claim after the app establishes its provider outcome. */
    releaseIdempotency: (
      ctx: MutationContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["releaseIdempotency"]>, "testMode">,
    ) =>
      ctx.runMutation(this.component.customers.releaseIdempotency, {
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Creates and reads Razorpay plans. */
  readonly plans = {
    /** Creates a plan and stores its mirror. */
    create: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["create"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        period: args.period,
        interval: args.interval,
        item: {
          name: args.item.name,
          amount: args.item.amount,
          currency: args.item.currency,
          description: args.item.description,
        },
        notes: args.notes,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.plans.create, componentArgs)
        .then((row) => exposeRow(row, (planId) => ({ planId })));
    },
    /** Fetches a plan without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPlanId: args.razorpayPlanId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.plans.fetch, componentArgs);
    },
    /** Fetches a provider page of plans without storing responses. */
    fetchAll: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["fetchAll"]>, "testMode">,
    ) => {
      const componentArgs = {
        count: args.count,
        skip: args.skip,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.plans.fetchAll, componentArgs);
    },
    /** Releases an unresolved plan claim after the app establishes its provider outcome. */
    releaseIdempotency: (
      ctx: MutationContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["releaseIdempotency"]>, "testMode">,
    ) =>
      ctx.runMutation(this.component.plans.releaseIdempotency, {
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Creates, reads, changes and cancels Razorpay subscriptions and verifies their Checkout payments. */
  readonly subscriptions = {
    /** Creates a subscription and stores its mirror. */
    create: async (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["create"]>, "testMode">,
    ) => {
      validateNotes(args.notes);
      validateNotes(args.metadata);
      const componentArgs = {
        razorpayPlanId: args.razorpayPlanId,
        totalCount: args.totalCount,
        quantity: args.quantity,
        startAt: args.startAt,
        expiresAt: args.expiresAt,
        customerNotify: args.customerNotify,
        razorpayOfferId: args.razorpayOfferId,
        notes: args.notes,
        userId: args.userId,
        externalId: args.externalId,
        metadata: args.metadata,
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.create, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Fetches a subscription without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        testMode: this.options.testMode,
      };
      return ctx.runAction(this.component.subscriptions.fetch, componentArgs);
    },
    /** Cancels a subscription immediately and stores its mirror. */
    cancel: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["cancel"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.cancel, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Schedules subscription cancellation at the current billing cycle end. */
    cancelAtCycleEnd: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["cancelAtCycleEnd"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.cancelAtCycleEnd, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Pauses an active subscription and stores its mirror. */
    pause: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["pause"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.pause, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Resumes a paused subscription and stores its mirror. */
    resume: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["resume"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.resume, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Updates a subscription and stores its mirror. */
    update: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["update"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        razorpayPlanId: args.razorpayPlanId,
        razorpayOfferId: args.razorpayOfferId,
        quantity: args.quantity,
        remainingCount: args.remainingCount,
        startAt: args.startAt,
        scheduleChangeAt: args.scheduleChangeAt,
        customerNotify: args.customerNotify,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.update, componentArgs)
        .then((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId })));
    },
    /** Reads a stored subscription in the selected test mode. */
    get: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["get"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        statuses: args.statuses,
        testMode: this.options.testMode,
      };
      return ctx
        .runQuery(this.component.subscriptions.get, componentArgs)
        .then((row) =>
          row === null ? null : exposeRow(row, (subscriptionId) => ({ subscriptionId })),
        );
    },
    /** Reads a bounded page of stored subscriptions. */
    list: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["list"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: args.paginationOpts.cursor,
          endCursor: args.paginationOpts.endCursor,
        },
        testMode: this.options.testMode,
      };
      return ctx.runQuery(this.component.subscriptions.list, componentArgs).then((result) => ({
        ...result,
        page: result.page.map((row) => exposeRow(row, (subscriptionId) => ({ subscriptionId }))),
      }));
    },
    /** Verifies the subscription Checkout signature and payment relationship. */
    verifyCheckout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["verifyCheckout"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpaySubscriptionId: args.razorpaySubscriptionId,
        razorpayPaymentId: args.razorpayPaymentId,
        signature: args.signature,
        userId: args.userId,
        testMode: this.options.testMode,
      };
      return ctx
        .runAction(this.component.subscriptions.verifyCheckout, componentArgs)
        .then((row) => exposeRow(row, (paymentId) => ({ paymentId })));
    },
    /** Releases an unresolved subscription claim after the app establishes its provider outcome. */
    releaseIdempotency: (
      ctx: MutationContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["releaseIdempotency"]>, "testMode">,
    ) =>
      ctx.runMutation(this.component.subscriptions.releaseIdempotency, {
        idempotencyKey: args.idempotencyKey,
        testMode: this.options.testMode,
      }),
  };

  /** Reads the effective component configuration with secrets omitted. */
  readonly config = {
    /** Returns test mode, whether calls are simulated, the public key ID and which secrets are set; throws `RAZORPAY_NOT_CONFIGURED` for a malformed env value. */
    get: (ctx: QueryContext) =>
      ctx.runQuery(this.component.config.get, { testMode: this.options.testMode }),
  };

  /** Verifies Razorpay payment link callback signatures. */
  readonly paymentLinks = {
    /** Verifies a payment link callback signature. */
    verifyCheckout: (
      ctx: ActionContext,
      args: FunctionArgs<ComponentApi["paymentLinks"]["verifyCheckout"]>,
    ) => {
      const componentArgs = {
        razorpayPaymentLinkId: args.razorpayPaymentLinkId,
        referenceId: args.referenceId,
        status: args.status,
        razorpayPaymentId: args.razorpayPaymentId,
        signature: args.signature,
      };
      return ctx.runAction(this.component.paymentLinks.verifyCheckout, componentArgs);
    },
  };

  /** Registers an HTTP route that verifies and applies signed Razorpay webhook events in the mode the component env selects, ignoring the client `testMode` option. `options.onEvent` replaces the constructor's `onEvent`. */
  registerRoutes(http: HttpRouter, options: RegisterRoutesOptions = {}): void {
    const { component } = this;
    const onEvent = options.onEvent ?? this.options.onEvent;
    http.route({
      path: options.path ?? "/razorpay/webhook",
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        let body: string | undefined;
        try {
          body = await readBoundedText(request, maxWebhookBodyBytes);
        } catch {
          return new Response("Webhook unavailable", { status: 500 });
        }
        if (body === undefined)
          return new Response("Webhook body exceeds limit or is not UTF-8", { status: 400 });
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const eventId = request.headers.get("x-razorpay-event-id") ?? "";
        try {
          const callbackHandle = onEvent ? await createFunctionHandle(onEvent) : undefined;
          await ctx.runAction(component.webhooks.ingest, {
            body,
            signature,
            eventId,
            callbackHandle,
          });
        } catch (error) {
          const badRequest =
            isRazorpayError(error) && error.data.code === "RAZORPAY_INVALID_WEBHOOK_SIGNATURE";
          return new Response(badRequest ? "Invalid webhook" : "Webhook unavailable", {
            status: badRequest ? 401 : 500,
          });
        }
        return new Response(null, { status: 200 });
      }),
    });
  }
}

/** Selects the webhook route path and internal event callback. */
export type RegisterRoutesOptions = {
  path?: `/${string}`;
  onEvent?: EventCallback;
};
