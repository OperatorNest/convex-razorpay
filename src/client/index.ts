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

import { maxWebhookBodyBytes } from "../shared/constants.js";

export { RAZORPAY_ERROR_CODES, isRazorpayError } from "../shared/errors.js";
export type { RazorpayErrorCode, RazorpayErrorData } from "../shared/errors.js";
export { computeSha256Hex, computeHmacSha256Hex, compareHexSignatures } from "../shared/crypto.js";

type ActionContext = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
type MutationContext = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type QueryContext = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
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
    ...options,
    ...(order.keyId === undefined ? {} : { key: order.keyId }),
    order_id: order.razorpayOrderId,
    amount: order.amount,
    currency: order.currency,
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
  constructor(
    private readonly component: ComponentApi,
    private readonly options: RazorpayOptions = {},
  ) {}

  readonly orders = {
    /** Creates a order and stores its mirror. */
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        amount: args.amount,
        currency: args.currency,
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        partialPayment: args.partialPayment,
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx
        .runAction(this.component.orders.create, componentArgs)
        .then(({ order, keyId }) => ({
          ...exposeRow(order, (orderId) => ({ orderId })),
          ...(keyId === undefined ? {} : { keyId }),
        }));
    },
    /** Fetches a order without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayOrderId: args.razorpayOrderId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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

  readonly payments = {
    /** Fetches a payment without storing the provider response. */
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPaymentId: args.razorpayPaymentId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.count === undefined ? {} : { count: args.count }),
        ...(args.skip === undefined ? {} : { skip: args.skip }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
          ...(args.paginationOpts.endCursor === undefined
            ? {}
            : { endCursor: args.paginationOpts.endCursor }),
        },
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.payments.list, componentArgs).then((result) => ({
        ...result,
        page: result.page.map((row) => exposeRow(row, (paymentId) => ({ paymentId }))),
      }));
    },
  };

  readonly refunds = {
    /** Creates a refund and stores its mirror. */
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPaymentId: args.razorpayPaymentId,
        amount: args.amount,
        speed: args.speed,
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.refunds.fetch, componentArgs);
    },
  };

  readonly customers = {
    /** Creates a customer and stores its mirror. */
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        name: args.name,
        email: args.email,
        ...(args.contact === undefined ? {} : { contact: args.contact }),
        ...(args.gstin === undefined ? {} : { gstin: args.gstin }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx
        .runAction(this.component.customers.create, componentArgs)
        .then((row) => exposeRow(row, (customerId) => ({ customerId })));
    },
    /** Returns or creates a customer linked to the requested app user. */
    getOrCreate: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["getOrCreate"]>, "testMode">,
    ) => {
      const componentArgs = {
        name: args.name,
        email: args.email,
        ...(args.contact === undefined ? {} : { contact: args.contact }),
        ...(args.gstin === undefined ? {} : { gstin: args.gstin }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.email === undefined ? {} : { email: args.email }),
        ...(args.contact === undefined ? {} : { contact: args.contact }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx
        .runQuery(this.component.customers.get, componentArgs)
        .then((row) => (row === null ? null : exposeRow(row, (customerId) => ({ customerId }))));
    },
  };

  readonly plans = {
    /** Creates a plan and stores its mirror. */
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        period: args.period,
        interval: args.interval,
        item: {
          name: args.item.name,
          amount: args.item.amount,
          currency: args.item.currency,
          ...(args.item.description === undefined ? {} : { description: args.item.description }),
        },
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.plans.fetch, componentArgs);
    },
    /** Fetches a provider page of plans without storing responses. */
    fetchAll: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["fetchAll"]>, "testMode">,
    ) => {
      const componentArgs = {
        ...(args.count === undefined ? {} : { count: args.count }),
        ...(args.skip === undefined ? {} : { skip: args.skip }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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

  readonly subscriptions = {
    /** Creates a subscription and stores its mirror. */
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        razorpayPlanId: args.razorpayPlanId,
        totalCount: args.totalCount,
        quantity: args.quantity,
        ...(args.startAt === undefined ? {} : { startAt: args.startAt }),
        ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
        customerNotify: args.customerNotify,
        ...(args.razorpayOfferId === undefined ? {} : { razorpayOfferId: args.razorpayOfferId }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.razorpayPlanId === undefined ? {} : { razorpayPlanId: args.razorpayPlanId }),
        ...(args.razorpayOfferId === undefined ? {} : { razorpayOfferId: args.razorpayOfferId }),
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.remainingCount === undefined ? {} : { remainingCount: args.remainingCount }),
        ...(args.startAt === undefined ? {} : { startAt: args.startAt }),
        scheduleChangeAt: args.scheduleChangeAt,
        ...(args.customerNotify === undefined ? {} : { customerNotify: args.customerNotify }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.statuses === undefined ? {} : { statuses: args.statuses }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
          ...(args.paginationOpts.endCursor === undefined
            ? {}
            : { endCursor: args.paginationOpts.endCursor }),
        },
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
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

  /** Registers the signed Razorpay webhook route and optional event callback. */
  registerRoutes(http: HttpRouter, options: RegisterRoutesOptions = {}) {
    return registerRoutes(http, this.component, {
      ...options,
      ...((options.onEvent ?? this.options.onEvent)
        ? { onEvent: options.onEvent ?? this.options.onEvent }
        : {}),
    });
  }
}

/** Selects the webhook route path and internal event callback. */
export type RegisterRoutesOptions = {
  path?: `/${string}`;
  onEvent?: EventCallback;
};

class WebhookBodyTooLarge extends Error {}
class WebhookBodyUndecodable extends Error {}

async function readWebhookBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  async function readChunk(): Promise<void> {
    const { done, value } = await reader.read();
    if (done) return;
    length += value.byteLength;
    if (length > maxWebhookBodyBytes) {
      void reader.cancel();
      throw new WebhookBodyTooLarge();
    }
    chunks.push(value);
    await readChunk();
  }
  await readChunk();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new WebhookBodyUndecodable();
  }
}

/** Registers an HTTP route that verifies and applies signed Razorpay webhook events. */
export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  { path = "/razorpay/webhook", onEvent }: RegisterRoutesOptions = {},
) {
  http.route({
    path,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      let body: string;
      try {
        body = await readWebhookBody(request);
      } catch (error) {
        if (error instanceof WebhookBodyTooLarge)
          return new Response("Webhook body too large", { status: 413 });
        if (error instanceof WebhookBodyUndecodable)
          return new Response("Invalid webhook body", { status: 400 });
        return new Response("Webhook unavailable", { status: 500 });
      }
      const signature = request.headers.get("x-razorpay-signature") ?? "";
      const eventId = request.headers.get("x-razorpay-event-id") ?? "";
      try {
        const callbackHandle = onEvent ? await createFunctionHandle(onEvent) : undefined;
        const ingestArgs = {
          body,
          signature,
          eventId,
          ...(callbackHandle === undefined ? {} : { callbackHandle }),
        };
        await ctx.runAction(component.webhooks.ingest, ingestArgs);
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
