import { queryOptions } from "@tanstack/react-query";

import { getCatalog, getOrder } from "./shop.functions";

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => getCatalog(),
  staleTime: 5 * 60 * 1000,
});

export const orderQuery = (code: string) =>
  queryOptions({
    queryKey: ["order", code],
    queryFn: () => getOrder({ data: { code } }),
  });
