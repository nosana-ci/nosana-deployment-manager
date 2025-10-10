import { Client } from "@nosana/sdk";
import { getConfig } from "../config/index.js";

export let sdk: Client;

export const initSdk = () => {
  sdk = new Client(getConfig().network);
}

export const getSdk = () => sdk || (sdk = new Client(getConfig().network));