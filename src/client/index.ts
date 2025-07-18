import { getDeepStore } from "deep-context-stores";
import createClient, { Middleware } from "openapi-fetch";
import { AuthorizationManager, getWallet, Wallet } from "@nosana/sdk";

export type QueryClient = ReturnType<typeof createClient<any, any | undefined>>;

export const clientSelector = (wallet: Wallet): QueryClient => {
  const { backend_url } = getDeepStore();
  let instance: QueryClient | undefined = undefined;

  if (!instance) {
    const userId = getWallet(wallet).publicKey.toString();
    const authorizationManager = new AuthorizationManager(wallet);

    const authMiddleware: Middleware = {
      onRequest({ request }) {
        request.headers.set("x-user-id", userId);
        request.headers.set(
          "Authorization",
          authorizationManager.generate("DeploymentsAuthorization", {
            includeTime: true,
          })
        );
      },
    };

    instance = createClient({
      baseUrl: `${backend_url}/api`,
      headers: {
        "Content-Type": "application/json",
      },
    });

    instance.use(authMiddleware);
  }

  return instance;
};
