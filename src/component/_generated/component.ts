/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    customers: {
      create: FunctionReference<
        "action",
        "internal",
        {
          contact?: string;
          email: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name: string;
          notes?: Record<string, string>;
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      edit: FunctionReference<
        "action",
        "internal",
        {
          contact?: string;
          customerId: string;
          email?: string;
          name?: string;
          testMode?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { customerId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      getByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          _creationTime: number;
          _id: string;
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        } | null,
        Name
      >;
      getOrCreate: FunctionReference<
        "action",
        "internal",
        {
          contact?: string;
          email: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name: string;
          notes?: Record<string, string>;
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
    };
    idempotency: {
      release: FunctionReference<
        "mutation",
        "internal",
        { key: string; resource: "order" | "plan" | "subscription" },
        boolean,
        Name
      >;
    };
    orders: {
      create: FunctionReference<
        "action",
        "internal",
        {
          amount: number;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          partialPayment?: boolean;
          receipt?: string;
          testMode?: boolean;
          userId?: string;
        },
        {
          keyId?: string;
          order: {
            _creationTime: number;
            _id: string;
            amount: number;
            amountDue: number;
            amountPaid: number;
            attempts: number;
            createdAt: number;
            createdThroughComponent?: boolean;
            currency: string;
            externalId?: string;
            idempotencyKey?: string;
            metadata?: Record<string, string>;
            notes: Record<string, string>;
            raw: any;
            rawStatus?: string;
            razorpayId: string;
            receipt?: string;
            status: string;
            testMode: boolean;
            updatedAtProvider: number;
            userId?: string;
          };
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { orderId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountDue: number;
          amountPaid: number;
          attempts: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          receipt?: string;
          status: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      fetchPayments: FunctionReference<
        "action",
        "internal",
        { orderId: string; testMode?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { orderId: string },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountDue: number;
          amountPaid: number;
          attempts: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          receipt?: string;
          status: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        } | null,
        Name
      >;
    };
    payments: {
      capture: FunctionReference<
        "action",
        "internal",
        {
          amount: number;
          currency: string;
          paymentId: string;
          testMode?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { paymentId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        },
        Name
      >;
      list: FunctionReference<
        "action",
        "internal",
        { count?: number; skip?: number; testMode?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        }>,
        Name
      >;
      listForOrder: FunctionReference<
        "query",
        "internal",
        { limit?: number; orderId: string },
        Array<{
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        }>,
        Name
      >;
    };
    plans: {
      create: FunctionReference<
        "action",
        "internal",
        {
          externalId?: string;
          idempotencyKey?: string;
          interval: number;
          item: {
            amount: number;
            currency: string;
            description?: string;
            name: string;
          };
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          createdAt: number;
          currency: string;
          description?: string;
          externalId?: string;
          idempotencyKey?: string;
          interval: number;
          itemName: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          period: string;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { planId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          createdAt: number;
          currency: string;
          description?: string;
          externalId?: string;
          idempotencyKey?: string;
          interval: number;
          itemName: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          period: string;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      list: FunctionReference<
        "action",
        "internal",
        { count?: number; skip?: number; testMode?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          amount: number;
          createdAt: number;
          currency: string;
          description?: string;
          externalId?: string;
          idempotencyKey?: string;
          interval: number;
          itemName: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          period: string;
          raw: any;
          razorpayId: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        }>,
        Name
      >;
    };
    refunds: {
      create: FunctionReference<
        "action",
        "internal",
        {
          amount?: number;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          paymentId: string;
          receipt?: string;
          speed?: "normal" | "optimum";
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          createdAt: number;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paymentId: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          receipt?: string;
          requestFingerprint?: string;
          speedProcessed?: string;
          speedRequested?: string;
          status: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { refundId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          createdAt: number;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paymentId: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          receipt?: string;
          requestFingerprint?: string;
          speedProcessed?: string;
          speedRequested?: string;
          status: string;
          testMode: boolean;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
    };
    subscriptions: {
      cancel: FunctionReference<
        "action",
        "internal",
        {
          cancelAtCycleEnd?: boolean;
          subscriptionId: string;
          testMode?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      create: FunctionReference<
        "action",
        "internal",
        {
          customerNotify?: boolean;
          expireBy?: number;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          offerId?: string;
          planId: string;
          quantity?: number;
          startAt?: number;
          testMode?: boolean;
          totalCount: number;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { subscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      getForUser: FunctionReference<
        "query",
        "internal",
        { statuses?: Array<string>; userId: string },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        } | null,
        Name
      >;
      listByUser: FunctionReference<
        "query",
        "internal",
        { limit?: number; userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        }>,
        Name
      >;
      pause: FunctionReference<
        "action",
        "internal",
        { subscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      resume: FunctionReference<
        "action",
        "internal",
        { subscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
      update: FunctionReference<
        "action",
        "internal",
        {
          customerNotify?: boolean;
          offerId?: string;
          planId?: string;
          quantity?: number;
          remainingCount?: number;
          scheduleChangeAt?: "now" | "cycle_end";
          startAt?: number;
          subscriptionId: string;
          testMode?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEnd?: number;
          currentStart?: number;
          customerId?: string;
          endAt?: number;
          endedAt?: number;
          expireBy?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          planId: string;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status: string;
          testMode: boolean;
          totalCount: number;
          updatedAtProvider: number;
          userId?: string;
        },
        Name
      >;
    };
    verification: {
      checkout: FunctionReference<
        "action",
        "internal",
        {
          orderId: string;
          paymentId: string;
          signature: string;
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        },
        Name
      >;
      paymentLink: FunctionReference<
        "action",
        "internal",
        {
          paymentId: string;
          paymentLinkId: string;
          referenceId: string;
          signature: string;
          status: string;
        },
        true,
        Name
      >;
      subscriptionCheckout: FunctionReference<
        "action",
        "internal",
        {
          paymentId: string;
          signature: string;
          subscriptionId: string;
          testMode?: boolean;
          userId?: string;
        },
        {
          _creationTime: number;
          _id: string;
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          customerId?: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          fee?: number;
          international?: boolean;
          invoiceId?: string;
          method?: string;
          notes: Record<string, string>;
          orderId?: string;
          raw: any;
          rawStatus?: string;
          razorpayId: string;
          refundStatus?: string;
          status: string;
          subscriptionId?: string;
          tax?: number;
          testMode: boolean;
          updatedAtProvider: number;
          verified: boolean;
        },
        Name
      >;
    };
    webhooks: {
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { batchSize?: number; before?: number },
        number,
        Name
      >;
      ingest: FunctionReference<
        "action",
        "internal",
        {
          body: string;
          callbackHandle?: string;
          eventId: string;
          signature: string;
        },
        {
          errorCode?: string;
          event?: {
            accountId?: string;
            createdAtProvider: number;
            entityId?: string;
            event: string;
            eventId: string;
          };
          status: "processed" | "duplicate" | "ignored" | "failed";
        },
        Name
      >;
    };
  };
