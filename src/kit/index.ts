import { createNosanaClient, NosanaClient, PartialClientConfig } from "@nosana/kit";
import { address as createAddress, Address, getAddressEncoder } from "@solana/addresses";

import { getConfig } from "../config/index.js";

export let kit: NosanaClient;

export const initKit = (): NosanaClient => {
  kit = getKit();
  return kit;
}

export const getKit = (): NosanaClient => {
  if (kit) return kit;

  const config = getConfig();
  const kitOptions: PartialClientConfig = {}

  if (config.dashboard_backend_url) {
    kitOptions.api = {
      backend_url: config.dashboard_backend_url,
    };
  }

  if (config.rpc_network) {
    kitOptions.solana = {
      rpcEndpoint: config.rpc_network,
      wsEndpoint: "wss://api.mainnet-beta.solana.com"
    };
  }

  kit = createNosanaClient(config.network, kitOptions);
  return kit;
};

export function convertAddressToUnit8Array(address: string | Address): Uint8Array {
  const addressObj = typeof address === 'string' ? createAddress(address) : address;
  return new Uint8Array(getAddressEncoder().encode(addressObj));
}