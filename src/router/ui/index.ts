import { PublicKey } from "@solana/web3.js";

type DisplayEncoding = "utf8" | "hex";
interface ConnectOpts {
  onlyIfTrusted: boolean;
}

declare global {
  interface Window {
    phantom?: {
      solana?: {
        isPhantom?: boolean;
        publicKey: PublicKey | null;
        isConnected: boolean | null;
        signMessage: (
          message: Uint8Array | string,
          display?: DisplayEncoding
        ) => Promise<{
          signature: Uint8Array;
        }>;
        connect: (
          opts?: Partial<ConnectOpts>
        ) => Promise<{ publicKey: PublicKey }>;
      };
    };
  }
}

export const nosanaLogo =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 630 160"><defs><style>.cls-1{fill:#fff;}.cls-2{fill:#10e80c;}</style></defs><g id="logasy"><path class="cls-1" d="M198.85,74.6v32.47H185.74V60.3c0-5,2.68-8.12,6.85-8.12,2,0,3.43.67,5.29,2.39l32.77,30.16V52.26h13.1V99.7c0,5-2.75,8.12-6.85,8.12a7,7,0,0,1-5.28-2.39Z"/><path class="cls-1" d="M280.2,107.07c-15.72,0-27.26-11.91-27.26-27.63,0-15.94,11.54-26.51,27.26-26.51h13.62c16.17,0,27.34,10.8,27.34,26.51s-11.47,27.63-27.34,27.63ZM293.82,93.3c8.05,0,13.64-5.52,13.64-13.19s-5.67-13.48-13.64-13.48H280.2a13.11,13.11,0,0,0-13.48,13.48c0,7.75,5.58,13.19,13.48,13.19Z"/><path class="cls-1" d="M330.57,107.07V93.3h41.18c3.2,0,5.14-1.5,5.14-4.18s-1.94-4.39-5.14-4.39H347.62c-11.09,0-17.94-6.41-17.94-15.79,0-9.16,6.4-16,18.09-16h39.4v13.7h-39.4A3.5,3.5,0,0,0,344,70.5a3.54,3.54,0,0,0,3.79,3.88h24c11.84,0,18.18,5,18.18,16,0,9.53-6,16.68-18.18,16.68Z"/><path class="cls-1" d="M408.77,62.6a15.24,15.24,0,0,1,4.13-6.92c1.94-1.83,4.6-2.75,8-2.75h16.16a12,12,0,0,1,8.28,2.75,14.6,14.6,0,0,1,4.33,6.92L463,107.07H448.13l-3.63-13-3.64-13-4.17-15.15h-15l-11.44,41.14H395.38Z"/><path class="cls-1" d="M549.88,62.6A15.24,15.24,0,0,1,554,55.68c1.94-1.83,4.6-2.75,8-2.75h16.16a12,12,0,0,1,8.28,2.75,14.6,14.6,0,0,1,4.33,6.92l13.3,44.47H589.24l-3.63-13-3.64-13L577.8,65.93h-15l-11.44,41.14H536.49Z"/><path class="cls-1" d="M484.37,74.6v32.47H471.26V60.3c0-5,2.69-8.12,6.86-8.12,2,0,3.42.67,5.28,2.39l32.77,30.16V52.26h13.11V99.7c0,5-2.76,8.12-6.85,8.12a7.06,7.06,0,0,1-5.29-2.39Z"/><path class="cls-2" d="M59.23,37.41A17.59,17.59,0,0,0,25.91,45.3v87H37.53v-87a6,6,0,0,1,11.32-2.68L88,120.68H75L54.59,80h-13l26.25,52.3h39Z"/><path class="cls-2" d="M132.83,27.7v87a6,6,0,0,1-11.31,2.68L82.37,39.32h13L115.78,80h13L102.54,27.7h-39l47.59,94.89a17.6,17.6,0,0,0,33.33-7.89v-87Z"/></g></svg>';

export function swaggerGenerateAuth() {
  if (typeof window === "undefined") return;
  // eslint-disable-next-line no-undef
  if (!window.phantom?.solana?.isPhantom) return;

  function base58Encode(buffer: Uint8Array): string {
    const ALPHABET =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    if (buffer.length === 0) return "";

    // Convert to big integer
    let num = 0n;
    for (let i = 0; i < buffer.length; i++) {
      num = num * 256n + BigInt(buffer[i]);
    }

    // Convert to base58
    let encoded = "";
    while (num > 0) {
      const remainder = num % 58n;
      num = num / 58n;
      encoded = ALPHABET[Number(remainder)] + encoded;
    }

    // Handle leading zeros
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      encoded = ALPHABET[0] + encoded;
    }

    return encoded;
  }

  function replaceAuthMessageText() {
    // eslint-disable-next-line no-undef
    const walker = document.createTreeWalker(
      // eslint-disable-next-line no-undef
      document.body,
      // eslint-disable-next-line no-undef
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes("Signed authentication message,")) {
        node.textContent = node.textContent.replace(
          /Signed authentication message,/g,
          "Signed authentication message, please ensure you have Authorized your session in swagger"
        );
      }
    }
  }

  function createAuthButton() {
    // eslint-disable-next-line no-undef
    const button = document.createElement("button");
    button.innerText = "Generate Auth Using Phantom";
    button.style.marginLeft = "10px";
    button.style.padding = "5px 10px";
    button.style.backgroundColor = "#007bff";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    // eslint-disable-next-line
    button.onclick = async function (event: any) {
      const buttonParent = event.target.parentNode;
      try {
        // eslint-disable-next-line no-undef
        let publicKey = window.phantom?.solana?.publicKey;

        if (publicKey === null) {
          // eslint-disable-next-line no-undef
          const connectResult = await window.phantom?.solana?.connect();
          if (connectResult) {
            publicKey = connectResult.publicKey;
          }
        }

        if (publicKey) {
          const message = "DeploymentsAuthorization";
          const encodedMessage = new TextEncoder().encode(
            "DeploymentsAuthorization"
          );
          // eslint-disable-next-line no-undef
          const response = await window.phantom?.solana?.signMessage(
            encodedMessage,
            "utf8"
          );

          if (!response || !response.signature) {
            // eslint-disable-next-line no-undef
            alert("Failed to sign message");
            return;
          }
          const token = `${message}:${base58Encode(
            response.signature
          )}:${new Date().getTime()}`;
          const userIdRow = buttonParent.querySelector(
            'tr[data-param-name="x-user-id"]'
          );

          const authTokenRow = buttonParent.querySelector(
            'tr[data-param-name="authorization"]'
          );
          if (userIdRow) {
            const container = userIdRow.querySelector(
              ".parameters-col_description"
            );
            // eslint-disable-next-line no-undef
            const p = document.createElement("p");
            p.onclick = () => {
              navigator.clipboard.writeText(publicKey.toBase58());
            };
            p.style.cursor = "pointer";
            p.style.color = "blue";
            p.style.textDecoration = "underline";
            p.style.margin = "0";
            p.style.fontSize = "12px";
            p.style.whiteSpace = "nowrap";
            p.title = "Click to copy public key";
            p.innerText = `${publicKey.toBase58()}`;
            container!.appendChild(p);
          }
          if (authTokenRow) {
            const container = authTokenRow.querySelector(
              ".parameters-col_description"
            );
            // eslint-disable-next-line no-undef
            const p = document.createElement("p");
            p.onclick = () => {
              navigator.clipboard.writeText(token);
            };
            p.style.cursor = "pointer";
            p.style.color = "blue";
            p.style.textDecoration = "underline";
            p.style.margin = "0";
            p.style.fontSize = "12px";
            p.style.whiteSpace = "nowrap";
            p.title = "Click to copy public key";
            p.innerText = `${token}`;
            container!.appendChild(p);
          }
        }
      } catch (error) {
        console.error("Error connecting to Phantom:", error);
      }
    };
    return button;
  }

  function addButtonToContainers() {
    // eslint-disable-next-line no-undef
    const authSections = document.querySelectorAll(
      ".parameters-container:not([data-auth-button])"
    );
    authSections.forEach((section) => {
      const button = createAuthButton();
      section.appendChild(button);
      section.setAttribute("data-auth-button", "true");
    });
  }

  // Initial attempt to add buttons
  replaceAuthMessageText();
  addButtonToContainers();

  // Watch for dynamically added elements
  // eslint-disable-next-line no-undef
  const observer = new MutationObserver(() => {
    addButtonToContainers();
  });

  // eslint-disable-next-line no-undef
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also try adding buttons after a short delay
  setTimeout(addButtonToContainers, 1000);
  setTimeout(addButtonToContainers, 3000);
  setTimeout(replaceAuthMessageText, 1000);
  setTimeout(replaceAuthMessageText, 3000);
}
