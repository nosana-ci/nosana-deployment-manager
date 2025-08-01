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
