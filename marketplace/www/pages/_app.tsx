import type { AppProps } from "next/app";
import { CartProvider } from "@/context/cart";
import "@/styles/globals.css";

export default function MarketplaceApp({ Component, pageProps }: AppProps) {
  return (
    <CartProvider>
      <Component {...pageProps} />
    </CartProvider>
  );
}
