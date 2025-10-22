import { Client } from "@nosana/sdk";
import { getConfig } from "../config/index.js";

export let sdk: Client;

export const initSdk = (): Client => {
  sdk = new Client(getConfig().network);
  return sdk;
}

export const getSdk = () => sdk || (sdk = new Client(getConfig().network));