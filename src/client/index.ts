import {
  createFunctionHandle,
  httpActionGeneric,
  type FunctionArgs,
  type FunctionReference_future,
  type GenericActionCtx,
  type GenericDataModel,
  type GenericQueryCtx,
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
  /**
   * Tri-state. `true` enables deterministic local test mode, `false` forces live mode even when
   * the component env has `RAZORPAY_TEST_MODE=true`, and `undefined` (the default) defers to
   * that env variable.
   */
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

/**
 * Builds Checkout.js options for an order returned by `orders.create`. Pure: it reads no
 * state. `key` is present only when the order carries a `keyId`, which credential-free test
 * mode does not, so supply a real Razorpay test key before opening Checkout.js.
 */
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

  private withTestMode<T extends object>(args: T): T & { testMode?: boolean } {
    return {
      ...args,
      ...(this.options.testMode === undefined ? {} : { testMode: this.options.testMode }),
    };
  }

  readonly orders = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["create"]>, "testMode">,
    ) =>
      ctx
        .runAction(this.component.orders.create, this.withTestMode(args))
        .then(({ order, keyId }) => ({ ...order, ...(keyId === undefined ? {} : { keyId }) })),
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.orders.fetch, this.withTestMode(args)),
    fetchPayments: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["orders"]["fetchPayments"]>, "testMode">,
    ) => ctx.runAction(this.component.orders.fetchPayments, this.withTestMode(args)),
    get: (ctx: QueryContext, args: FunctionArgs<ComponentApi["orders"]["get"]>) =>
      ctx.runQuery(this.component.orders.get, args),
  };

  readonly payments = {
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.payments.fetch, this.withTestMode(args)),
    capture: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["capture"]>, "testMode">,
    ) => ctx.runAction(this.component.payments.capture, this.withTestMode(args)),
    list: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["payments"]["list"]>, "testMode">,
    ) => ctx.runAction(this.component.payments.list, this.withTestMode(args)),
    listForOrder: (
      ctx: QueryContext,
      args: FunctionArgs<ComponentApi["payments"]["listForOrder"]>,
    ) => ctx.runQuery(this.component.payments.listForOrder, args),
  };

  readonly refunds = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["create"]>, "testMode">,
    ) => ctx.runAction(this.component.refunds.create, this.withTestMode(args)),
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["refunds"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.refunds.fetch, this.withTestMode(args)),
  };

  readonly customers = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["create"]>, "testMode">,
    ) => ctx.runAction(this.component.customers.create, this.withTestMode(args)),
    getOrCreate: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["getOrCreate"]>, "testMode">,
    ) => ctx.runAction(this.component.customers.getOrCreate, this.withTestMode(args)),
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.customers.fetch, this.withTestMode(args)),
    edit: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["customers"]["edit"]>, "testMode">,
    ) => ctx.runAction(this.component.customers.edit, this.withTestMode(args)),
    getByUser: (ctx: QueryContext, args: FunctionArgs<ComponentApi["customers"]["getByUser"]>) =>
      ctx.runQuery(this.component.customers.getByUser, args),
  };

  readonly plans = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["create"]>, "testMode">,
    ) => ctx.runAction(this.component.plans.create, this.withTestMode(args)),
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.plans.fetch, this.withTestMode(args)),
    list: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["plans"]["list"]>, "testMode">,
    ) => ctx.runAction(this.component.plans.list, this.withTestMode(args)),
  };

  readonly subscriptions = {
    create: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["create"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.create, this.withTestMode(args)),
    fetch: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["fetch"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.fetch, this.withTestMode(args)),
    cancel: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["cancel"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.cancel, this.withTestMode(args)),
    pause: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["pause"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.pause, this.withTestMode(args)),
    resume: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["resume"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.resume, this.withTestMode(args)),
    update: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["subscriptions"]["update"]>, "testMode">,
    ) => ctx.runAction(this.component.subscriptions.update, this.withTestMode(args)),
    getForUser: (
      ctx: QueryContext,
      args: FunctionArgs<ComponentApi["subscriptions"]["getForUser"]>,
    ) => ctx.runQuery(this.component.subscriptions.getForUser, args),
    listByUser: (
      ctx: QueryContext,
      args: FunctionArgs<ComponentApi["subscriptions"]["listByUser"]>,
    ) => ctx.runQuery(this.component.subscriptions.listByUser, args),
  };

  readonly verification = {
    checkout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["verification"]["checkout"]>, "testMode">,
    ) => ctx.runAction(this.component.verification.checkout, this.withTestMode(args)),
    subscriptionCheckout: (
      ctx: ActionContext,
      args: Omit<FunctionArgs<ComponentApi["verification"]["subscriptionCheckout"]>, "testMode">,
    ) => ctx.runAction(this.component.verification.subscriptionCheckout, this.withTestMode(args)),
    paymentLink: (
      ctx: ActionContext,
      args: FunctionArgs<ComponentApi["verification"]["paymentLink"]>,
    ) => ctx.runAction(this.component.verification.paymentLink, args),
  };

  readonly webhooks = {
    cleanup: (ctx: MutationContext, args: FunctionArgs<ComponentApi["webhooks"]["cleanup"]>) =>
      ctx.runMutation(this.component.webhooks.cleanup, args),
  };

  readonly idempotency = {
    release: (ctx: MutationContext, args: FunctionArgs<ComponentApi["idempotency"]["release"]>) =>
      ctx.runMutation(this.component.idempotency.release, args),
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
  while (true) {
    // Read the request stream sequentially so the body limit applies before buffering it.
    // eslint-disable-next-line eslint/no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxWebhookBodyBytes) {
      void reader.cancel();
      throw new WebhookBodyTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
        await ctx.runAction(component.webhooks.ingest, {
          body,
          signature,
          eventId,
          ...(callbackHandle === undefined ? {} : { callbackHandle }),
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
