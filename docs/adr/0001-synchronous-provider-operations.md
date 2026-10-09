# ADR 0001: Synchronous Razorpay operations

## Context

Provider operations return their result directly to the initiating app. Razorpay order, refund, customer, plan, and subscription calls are app-initiated operations whose result must be returned to that app action. A generic retry after an ambiguous payment outcome could create duplicate financial state.

## Decision

The caller awaits each provider call from a Convex action. The component uses local idempotency claims where applicable, requires a key or receipt for refunds, and reconciles ambiguous plan and subscription creates before retrying. It has no runtime queue dependency or automatic provider retry loop.

## Consequences

The initiating app action observes the result or a classified error. The app must choose when to retry. Delivery does not continue after the caller ends, so workflows requiring durable background execution must add their own orchestration around the component.
