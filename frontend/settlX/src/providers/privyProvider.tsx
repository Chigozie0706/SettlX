"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { useEffect } from "react";
import { arbitrum } from "viem/chains";

const config = createConfig({
  chains: [arbitrum],
  transports: {
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
  },
  ssr: true,
});

const privyConfig: PrivyClientConfig = {
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
    // requireUserPasswordOnCreate: true,
    // noPromptOnSignature: false,
  },
  loginMethods: ["wallet", "email", "sms"],
  appearance: {
    showWalletLoginFirst: true,
  },
  defaultChain: arbitrum,
};
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export function PrivyProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // apiUrl={process.env.NEXT_PUBLIC_PRIVY_AUTH_URL as string}
        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID as string}
        config={privyConfig}
      >
        <PrivyInitializationTracker>
          <WagmiProvider config={config}>{children}</WagmiProvider>
        </PrivyInitializationTracker>
      </PrivyProvider>
    </QueryClientProvider>
  );
}

function PrivyInitializationTracker({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated } = usePrivy();

  useEffect(() => {
    console.log("Privy State Changed:", { ready, authenticated });
  }, [ready, authenticated]);

  return <>{children}</>;
}
