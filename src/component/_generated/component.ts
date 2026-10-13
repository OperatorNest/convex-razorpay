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
    config: {
      get: FunctionReference<
        "query",
        "internal",
        { testMode?: boolean },
        {
          hasKeySecret: boolean;
          hasPreviousWebhookSecret: boolean;
          hasWebhookSecret: boolean;
          isSimulated: boolean;
          keyId: string | null;
          testMode: boolean;
        },
        Name
      >;
    };
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
          providerUpdatedAt: number;
          raw: any;
          razorpayCustomerId: string;
          requestFingerprint?: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      edit: FunctionReference<
        "action",
        "internal",
        {
          contact?: string;
          email?: string;
          name?: string;
          razorpayCustomerId: string;
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
          providerUpdatedAt: number;
          raw: any;
          razorpayCustomerId: string;
          requestFingerprint?: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpayCustomerId: string; testMode?: boolean },
        {
          contact?: string;
          createdAt: number;
          email?: string;
          externalId?: string;
          gstin?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          name?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          razorpayCustomerId: string;
          requestFingerprint?: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { testMode?: boolean; userId: string },
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
          providerUpdatedAt: number;
          raw: any;
          razorpayCustomerId: string;
          requestFingerprint?: string;
          testMode: boolean;
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
          providerUpdatedAt: number;
          raw: any;
          razorpayCustomerId: string;
          requestFingerprint?: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      releaseIdempotency: FunctionReference<
        "mutation",
        "internal",
        { idempotencyKey: string; testMode?: boolean },
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
          partialPayment: boolean;
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
            partialPayment: boolean;
            providerUpdatedAt: number;
            raw: any;
            rawStatus?: string;
            razorpayOrderId: string;
            receipt?: string;
            status: "created" | "attempted" | "paid" | "unknown";
            testMode: boolean;
            userId?: string;
          };
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpayOrderId: string; testMode?: boolean },
        {
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
          partialPayment: boolean;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayOrderId: string;
          receipt?: string;
          status: "created" | "attempted" | "paid" | "unknown";
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      fetchPayments: FunctionReference<
        "action",
        "internal",
        { razorpayOrderId: string; testMode?: boolean },
        Array<{
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        }>,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { razorpayOrderId: string; testMode?: boolean },
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
          partialPayment: boolean;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayOrderId: string;
          receipt?: string;
          status: "created" | "attempted" | "paid" | "unknown";
          testMode: boolean;
          userId?: string;
        } | null,
        Name
      >;
      releaseIdempotency: FunctionReference<
        "mutation",
        "internal",
        { idempotencyKey: string; testMode?: boolean },
        boolean,
        Name
      >;
      verifyCheckout: FunctionReference<
        "action",
        "internal",
        {
          razorpayOrderId: string;
          razorpayPaymentId: string;
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
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        },
        Name
      >;
    };
    paymentLinks: {
      verifyCheckout: FunctionReference<
        "action",
        "internal",
        {
          razorpayPaymentId: string;
          razorpayPaymentLinkId: string;
          referenceId: string;
          signature: string;
          status:
            "created" | "partially_paid" | "paid" | "expired" | "cancelled";
        },
        true,
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
          razorpayPaymentId: string;
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
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpayPaymentId: string; testMode?: boolean },
        {
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        },
        Name
      >;
      fetchAll: FunctionReference<
        "action",
        "internal",
        { count?: number; skip?: number; testMode?: boolean },
        Array<{
          amount: number;
          amountRefunded: number;
          captured: boolean;
          contact?: string;
          createdAt: number;
          currency: string;
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        }>,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          razorpayOrderId: string;
          testMode?: boolean;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            amount: number;
            amountRefunded: number;
            captured: boolean;
            contact?: string;
            createdAt: number;
            currency: string;
            email?: string;
            errorCode?: string;
            errorDescription?: string;
            errorReason?: string;
            errorSource?: string;
            errorStep?: string;
            externalId?: string;
            fee?: number;
            international?: boolean;
            method?: string;
            notes: Record<string, string>;
            providerUpdatedAt: number;
            raw: any;
            rawStatus?: string;
            razorpayCustomerId?: string;
            razorpayInvoiceId?: string;
            razorpayOrderId?: string;
            razorpayPaymentId: string;
            razorpaySubscriptionId?: string;
            refundStatus?: "partial" | "full";
            status:
              | "created"
              | "authorized"
              | "captured"
              | "refunded"
              | "failed"
              | "unknown";
            tax?: number;
            testMode: boolean;
            userId?: string;
            verified: boolean;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
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
          providerUpdatedAt: number;
          raw: any;
          razorpayPlanId: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpayPlanId: string; testMode?: boolean },
        {
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
          providerUpdatedAt: number;
          raw: any;
          razorpayPlanId: string;
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      fetchAll: FunctionReference<
        "action",
        "internal",
        { count?: number; skip?: number; testMode?: boolean },
        Array<{
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
          providerUpdatedAt: number;
          raw: any;
          razorpayPlanId: string;
          testMode: boolean;
          userId?: string;
        }>,
        Name
      >;
      releaseIdempotency: FunctionReference<
        "mutation",
        "internal",
        { idempotencyKey: string; testMode?: boolean },
        boolean,
        Name
      >;
    };
    refunds: {
      create: FunctionReference<
        "action",
        "internal",
        {
          amount: number;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          razorpayPaymentId: string;
          receipt?: string;
          speed: "normal" | "optimum";
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
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayPaymentId: string;
          razorpayRefundId: string;
          receipt?: string;
          requestFingerprint?: string;
          speedProcessed?: string;
          speedRequested?: string;
          status: "pending" | "processed" | "failed" | "unknown";
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpayRefundId: string; testMode?: boolean },
        {
          amount: number;
          createdAt: number;
          currency: string;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayPaymentId: string;
          razorpayRefundId: string;
          receipt?: string;
          requestFingerprint?: string;
          speedProcessed?: string;
          speedRequested?: string;
          status: "pending" | "processed" | "failed" | "unknown";
          testMode: boolean;
          userId?: string;
        },
        Name
      >;
    };
    subscriptions: {
      cancel: FunctionReference<
        "action",
        "internal",
        { razorpaySubscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      cancelAtCycleEnd: FunctionReference<
        "action",
        "internal",
        { razorpaySubscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      create: FunctionReference<
        "action",
        "internal",
        {
          customerNotify: boolean;
          expiresAt?: number;
          externalId?: string;
          idempotencyKey?: string;
          metadata?: Record<string, string>;
          notes?: Record<string, string>;
          quantity: number;
          razorpayOfferId?: string;
          razorpayPlanId: string;
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
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      fetch: FunctionReference<
        "action",
        "internal",
        { razorpaySubscriptionId: string; testMode?: boolean },
        {
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        {
          statuses?: Array<
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown"
          >;
          testMode?: boolean;
          userId: string;
        },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          testMode?: boolean;
          userId: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            chargeAt?: number;
            createdAt: number;
            createdThroughComponent?: boolean;
            currentEndAt?: number;
            currentStartAt?: number;
            endAt?: number;
            endedAt?: number;
            expiresAt?: number;
            externalId?: string;
            hasScheduledChanges: boolean;
            idempotencyKey?: string;
            lastWebhookAt?: number;
            metadata?: Record<string, string>;
            notes: Record<string, string>;
            paidCount: number;
            pausedAt?: number;
            providerUpdatedAt: number;
            quantity: number;
            raw: any;
            rawStatus?: string;
            razorpayCustomerId?: string;
            razorpayPlanId: string;
            razorpaySubscriptionId: string;
            remainingCount: number;
            shortUrl?: string;
            startAt?: number;
            status:
              | "created"
              | "authenticated"
              | "active"
              | "pending"
              | "halted"
              | "paused"
              | "cancelled"
              | "completed"
              | "expired"
              | "unknown";
            testMode: boolean;
            totalCount: number;
            userId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      pause: FunctionReference<
        "action",
        "internal",
        { razorpaySubscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      releaseIdempotency: FunctionReference<
        "mutation",
        "internal",
        { idempotencyKey: string; testMode?: boolean },
        boolean,
        Name
      >;
      resume: FunctionReference<
        "action",
        "internal",
        { razorpaySubscriptionId: string; testMode?: boolean },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      update: FunctionReference<
        "action",
        "internal",
        {
          customerNotify?: boolean;
          quantity?: number;
          razorpayOfferId?: string;
          razorpayPlanId?: string;
          razorpaySubscriptionId: string;
          remainingCount?: number;
          scheduleChangeAt: "now" | "cycle_end";
          startAt?: number;
          testMode?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          chargeAt?: number;
          createdAt: number;
          createdThroughComponent?: boolean;
          currentEndAt?: number;
          currentStartAt?: number;
          endAt?: number;
          endedAt?: number;
          expiresAt?: number;
          externalId?: string;
          hasScheduledChanges: boolean;
          idempotencyKey?: string;
          lastWebhookAt?: number;
          metadata?: Record<string, string>;
          notes: Record<string, string>;
          paidCount: number;
          pausedAt?: number;
          providerUpdatedAt: number;
          quantity: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayPlanId: string;
          razorpaySubscriptionId: string;
          remainingCount: number;
          shortUrl?: string;
          startAt?: number;
          status:
            | "created"
            | "authenticated"
            | "active"
            | "pending"
            | "halted"
            | "paused"
            | "cancelled"
            | "completed"
            | "expired"
            | "unknown";
          testMode: boolean;
          totalCount: number;
          userId?: string;
        },
        Name
      >;
      verifyCheckout: FunctionReference<
        "action",
        "internal",
        {
          razorpayPaymentId: string;
          razorpaySubscriptionId: string;
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
          email?: string;
          errorCode?: string;
          errorDescription?: string;
          errorReason?: string;
          errorSource?: string;
          errorStep?: string;
          externalId?: string;
          fee?: number;
          international?: boolean;
          method?: string;
          notes: Record<string, string>;
          providerUpdatedAt: number;
          raw: any;
          rawStatus?: string;
          razorpayCustomerId?: string;
          razorpayInvoiceId?: string;
          razorpayOrderId?: string;
          razorpayPaymentId: string;
          razorpaySubscriptionId?: string;
          refundStatus?: "partial" | "full";
          status:
            | "created"
            | "authorized"
            | "captured"
            | "refunded"
            | "failed"
            | "unknown";
          tax?: number;
          testMode: boolean;
          userId?: string;
          verified: boolean;
        },
        Name
      >;
    };
    webhooks: {
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
            event: string;
            eventId: string;
            providerCreatedAt: number;
            razorpayAccountId?: string;
            razorpayEntityId?: string;
          };
          status: "processed" | "duplicate" | "ignored" | "failed";
        },
        Name
      >;
    };
  };
