import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const withCredentials: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
  });

/**
 * 留档回测的「证券名称 / 代码」查询走 **POST 批处理**，其余查询维持 GET。
 *
 * 为什么必须分开：`trades[].securityId` 是 canonical identity，单个就有 ~68 字符
 * （`sec_<uuid>::event:002869.SZ@2019-01-02`）。一份 1,000+ 笔的留档里 identity 去重后
 * 仍可能有几百个，塞进 query string 会把 URL 撑到几十 KB —— Node 的请求行上限（默认
 * 16KB）先于业务逻辑拒绝它，前端看到的是 `Input is too big for a single dispatch`
 * 或 `431`，而**不是**「查不到名称」。
 *
 * 这条查询是纯读取、无副作用，用 POST 把入参放进请求体即可彻底摆脱 URL 长度约束；
 * 其余查询保持 GET（可被浏览器 / 中间层缓存，行为与改动前一致）。
 */
const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.path === "researchRun.securityLabels",
      true: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        methodOverride: "POST",
        fetch: withCredentials,
      }),
      false: httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch: withCredentials,
      }),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
