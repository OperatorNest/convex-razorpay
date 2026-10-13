import {
  createFunctionHandle,
  httpActionGeneric,
  type FunctionArgs,
  type FunctionReference_future,
  type GenericActionCtx,
  type GenericQueryCtx,
  type GenericDataModel,
  type HttpRouter,
} from "convex/server";
import type { Infer } from "convex/values";
import { webhookEventValidator } from "../shared/validators.js";
import type { ComponentApi } from "../component/_generated/component.js";
import { isRazorpayError } from "../shared/errors.js";
import { maxWebhookBodyBytes } from "../shared/constants.js";

export { isRazorpayError } from "../shared/errors.js";
export type { RazorpayError, RazorpayErrorCode, RazorpayErrorData } from "../shared/errors.js";
export { sha256Hex, hmacSha256Hex, constantTimeEqualHex } from "../shared/crypto.js";

type ActionContext = Pick<GenericActionCtx<GenericDataModel>, "runAction">;
type MutationContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type QueryContext = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
export type RazorpayWebhookEventArgs = Infer<typeof webhookEventValidator>;
type EventCallback = FunctionReference_future<
  "mutation",
  "internal",
  RazorpayWebhookEventArgs,
  unknown
>;

export type RazorpayOptions = {
  testMode?: boolean;
  onEvent?: EventCallback;
};

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

export function checkoutOptions(
  order: { razorpayId: string; amount: number; currency: string; keyId?: string },
  options?: Omit<CheckoutOptions, "key" | "order_id" | "amount" | "currency">,
): CheckoutOptions {
  return {
    ...options,
    ...(order.keyId === undefined ? {} : { key: order.keyId }),
    order_id: order.razorpayId,
    amount: order.amount,
    currency: order.currency,
  };
}

export class Razorpay {
  constructor(
    private readonly component: ComponentApi,
    private readonly options: RazorpayOptions = {},
  ) {}

  readonly orders = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        amount: args.amount,
        currency: args.currency,
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.partialPayment === undefined ? {} : { partialPayment: args.partialPayment }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx
        .runAction(this.component.orders.create, componentArgs)
        .then(({ order, keyId }) => ({ ...order, ...(keyId === undefined ? {} : { keyId }) }));
    },
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        orderId: args.orderId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.orders.fetch, componentArgs);
    },
    fetchPayments: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetchPayments"]>, "testMode">,
    ) => {
      const componentArgs = {
        orderId: args.orderId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.orders.fetchPayments, componentArgs);
    },
    get: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["get"]>, "testMode">,
    ) => {
      const componentArgs = {
        orderId: args.orderId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.orders.get, componentArgs);
    },
  };

  readonly payments = {
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        paymentId: args.paymentId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.payments.fetch, componentArgs);
    },
    capture: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["capture"]>, "testMode">,
    ) => {
      const componentArgs = {
        paymentId: args.paymentId,
        amount: args.amount,
        currency: args.currency,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.payments.capture, componentArgs);
    },
    list: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["list"]>, "testMode">,
    ) => {
      const componentArgs = {
        ...(args.count === undefined ? {} : { count: args.count }),
        ...(args.skip === undefined ? {} : { skip: args.skip }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.payments.list, componentArgs);
    },
    listForOrder: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["listForOrder"]>, "testMode">,
    ) => {
      const componentArgs = {
        orderId: args.orderId,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.payments.listForOrder, componentArgs);
    },
  };

  readonly refunds = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        paymentId: args.paymentId,
        ...(args.amount === undefined ? {} : { amount: args.amount }),
        ...(args.speed === undefined ? {} : { speed: args.speed }),
        ...(args.receipt === undefined ? {} : { receipt: args.receipt }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.refunds.create, componentArgs);
    },
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        refundId: args.refundId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.refunds.fetch, componentArgs);
    },
  };

  readonly customers = {
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
      return ctx.runAction(this.component.customers.create, componentArgs);
    },
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
      return ctx.runAction(this.component.customers.getOrCreate, componentArgs);
    },
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        customerId: args.customerId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.customers.fetch, componentArgs);
    },
    edit: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["edit"]>, "testMode">,
    ) => {
      const componentArgs = {
        customerId: args.customerId,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.email === undefined ? {} : { email: args.email }),
        ...(args.contact === undefined ? {} : { contact: args.contact }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.customers.edit, componentArgs);
    },
    getByUser: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["getByUser"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.customers.getByUser, componentArgs);
    },
  };

  readonly plans = {
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
      return ctx.runAction(this.component.plans.create, componentArgs);
    },
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        planId: args.planId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.plans.fetch, componentArgs);
    },
    list: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["list"]>, "testMode">,
    ) => {
      const componentArgs = {
        ...(args.count === undefined ? {} : { count: args.count }),
        ...(args.skip === undefined ? {} : { skip: args.skip }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.plans.list, componentArgs);
    },
  };

  readonly subscriptions = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["create"]>, "testMode">,
    ) => {
      const componentArgs = {
        planId: args.planId,
        totalCount: args.totalCount,
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.startAt === undefined ? {} : { startAt: args.startAt }),
        ...(args.expireBy === undefined ? {} : { expireBy: args.expireBy }),
        ...(args.customerNotify === undefined ? {} : { customerNotify: args.customerNotify }),
        ...(args.offerId === undefined ? {} : { offerId: args.offerId }),
        ...(args.notes === undefined ? {} : { notes: args.notes }),
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
        ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.create, componentArgs);
    },
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["fetch"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.fetch, componentArgs);
    },
    cancel: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["cancel"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        ...(args.cancelAtCycleEnd === undefined ? {} : { cancelAtCycleEnd: args.cancelAtCycleEnd }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.cancel, componentArgs);
    },
    pause: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["pause"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.pause, componentArgs);
    },
    resume: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["resume"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.resume, componentArgs);
    },
    update: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["update"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        ...(args.planId === undefined ? {} : { planId: args.planId }),
        ...(args.offerId === undefined ? {} : { offerId: args.offerId }),
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.remainingCount === undefined ? {} : { remainingCount: args.remainingCount }),
        ...(args.startAt === undefined ? {} : { startAt: args.startAt }),
        ...(args.scheduleChangeAt === undefined ? {} : { scheduleChangeAt: args.scheduleChangeAt }),
        ...(args.customerNotify === undefined ? {} : { customerNotify: args.customerNotify }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.subscriptions.update, componentArgs);
    },
    getForUser: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["getForUser"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        ...(args.statuses === undefined ? {} : { statuses: args.statuses }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.subscriptions.getForUser, componentArgs);
    },
    listByUser: (
      ctx: QueryContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["listByUser"]>, "testMode">,
    ) => {
      const componentArgs = {
        userId: args.userId,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runQuery(this.component.subscriptions.listByUser, componentArgs);
    },
  };

  readonly verification = {
    checkout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["verification"]["checkout"]>, "testMode">,
    ) => {
      const componentArgs = {
        orderId: args.orderId,
        paymentId: args.paymentId,
        signature: args.signature,
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.verification.checkout, componentArgs);
    },
    subscriptionCheckout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["verification"]["subscriptionCheckout"]>, "testMode">,
    ) => {
      const componentArgs = {
        subscriptionId: args.subscriptionId,
        paymentId: args.paymentId,
        signature: args.signature,
        ...(args.userId === undefined ? {} : { userId: args.userId }),
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runAction(this.component.verification.subscriptionCheckout, componentArgs);
    },
    paymentLink: (
      ctx: ActionContext,
      args: FunctionArgs<ComponentApi["verification"]["paymentLink"]>,
    ) => {
      const componentArgs = {
        paymentLinkId: args.paymentLinkId,
        referenceId: args.referenceId,
        status: args.status,
        paymentId: args.paymentId,
        signature: args.signature,
      };
      return ctx.runAction(this.component.verification.paymentLink, componentArgs);
    },
  };

  readonly webhooks = {
    cleanup: (ctx: MutationContext, args: FunctionArgs<ComponentApi["webhooks"]["cleanup"]>) => {
      const componentArgs = {
        ...(args.before === undefined ? {} : { before: args.before }),
        ...(args.batchSize === undefined ? {} : { batchSize: args.batchSize }),
      };
      return ctx.runMutation(this.component.webhooks.cleanup, componentArgs);
    },
  };

  readonly idempotency = {
    release: (
      ctx: MutationContext,
      args: Omit<FunctionArgs<ComponentApi["idempotency"]["release"]>, "testMode">,
    ) => {
      const componentArgs = {
        resource: args.resource,
        key: args.key,
        ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
      };
      return ctx.runMutation(this.component.idempotency.release, componentArgs);
    },
  };

  registerRoutes(http: HttpRouter, options: RegisterRoutesOptions = {}) {
    return registerRoutes(http, this.component, {
      ...options,
      ...((options.onEvent ?? this.options.onEvent)
        ? { onEvent: options.onEvent ?? this.options.onEvent }
        : {}),
    });
  }
}

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
