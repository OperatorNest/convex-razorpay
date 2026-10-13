import type { PaginationOptions, PaginationResult } from "convex/server";
import { jsonToConvex } from "convex/values";
import { razorpayError } from "../shared/errors.js";

export async function boundedPage<T>(
  query: { paginate(options: PaginationOptions): Promise<PaginationResult<T>> },
  paginationOpts: PaginationOptions,
) {
  if (
    !Number.isSafeInteger(paginationOpts.numItems) ||
    paginationOpts.numItems < 1 ||
    paginationOpts.numItems > 100
  )
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  try {
    for (const cursor of [paginationOpts.cursor, paginationOpts.endCursor]) {
      if (cursor === null || cursor === undefined) continue;
      if (!Array.isArray(jsonToConvex(JSON.parse(cursor))))
        throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
    }
    const result = await query.paginate({
      numItems: paginationOpts.numItems,
      cursor: paginationOpts.cursor,
      ...(paginationOpts.endCursor === undefined ? {} : { endCursor: paginationOpts.endCursor }),
      maximumRowsRead: paginationOpts.numItems + 1,
    });
    return { page: result.page, isDone: result.isDone, continueCursor: result.continueCursor };
  } catch {
    throw razorpayError("RAZORPAY_INVALID_ARGUMENT");
  }
}
