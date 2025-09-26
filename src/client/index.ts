import createClient, { Middleware } from "openapi-fetch";
import { AuthorizationManager, getWallet, Wallet } from "@nosana/sdk";

export type QueryClient = ReturnType<typeof createClient>;

export const clientSelector = (wallet: Wallet): QueryClient => {
  let instance: QueryClient | undefined = undefined;

  if (!instance) {
    const userId = getWallet(wallet).publicKey.toString();
    const authorizationManager = new AuthorizationManager(wallet);

    const authMiddleware: Middleware = {
      async onRequest({ request }) {
        request.headers.set("x-user-id", userId);
        request.headers.set(
          "Authorization",
          await authorizationManager.generate("DeploymentsAuthorization", {
            includeTime: true,
          }),
        );
      },
    };

    instance = createClient({
      baseUrl: `${process.env}/api`,
      headers: {
        "Content-Type": "application/json",
      },
    });

    instance.use(authMiddleware);
  }

  return instance;
};
