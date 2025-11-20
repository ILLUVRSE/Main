import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { CartItem, CartItemInput } from "@/lib/types";

interface CartState {
  items: CartItem[];
}

interface CartContextValue extends CartState {
  totalItems: number;
  addItem: (item: CartItemInput) => void;
  removeItem: (skuId: string, versionId: string, buyerKeyPem?: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "illuvrse.marketplace.cart.v1";

const CartContext = createContext<CartContextValue | undefined>(undefined);

type CartAction =
  | { type: "add"; payload: CartItemInput }
  | { type: "remove"; payload: { skuId: string; versionId: string } }
  | { type: "clear" }
  | { type: "hydrate"; payload: CartItem[] };

const initialState: CartState = { items: [] };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "hydrate":
      return { items: action.payload };
    case "add": {
      const existingIndex = state.items.findIndex(
        (item) =>
          item.skuId === action.payload.skuId &&
          item.versionId === action.payload.versionId &&
          item.buyerKeyPem === action.payload.buyerKeyPem
      );
      if (existingIndex >= 0) {
        const nextItems = [...state.items];
        nextItems[existingIndex] = {
          ...nextItems[existingIndex],
          quantity: nextItems[existingIndex].quantity + (action.payload.quantity ?? 1),
        };
        return { items: nextItems };
      }
      return {
        items: [
          ...state.items,
          {
            ...action.payload,
            quantity: action.payload.quantity ?? 1,
          } as CartItem,
        ],
      };
    }
    case "remove":
      return {
        items: state.items.filter(
          (item) =>
            !(
              item.skuId === action.payload.skuId &&
              item.versionId === action.payload.versionId &&
              item.buyerKeyPem === action.payload.buyerKeyPem
            )
        ),
      };
    case "clear":
      return initialState;
    default:
      return state;
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);
  const hasHydrated = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || hasHydrated.current) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: CartItem[] = JSON.parse(raw);
        dispatch({ type: "hydrate", payload: parsed });
      }
    } catch (error) {
      console.warn("Failed to hydrate cart", error);
    } finally {
      hasHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasHydrated.current) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  }, [state.items]);

  const totalItems = useMemo(() => state.items.reduce((sum, item) => sum + item.quantity, 0), [state.items]);

  const value = useMemo<CartContextValue>(
    () => ({
      items: state.items,
      totalItems,
      addItem: (item) => dispatch({ type: "add", payload: item }),
      removeItem: (skuId, versionId, buyerKeyPem) =>
        dispatch({ type: "remove", payload: { skuId, versionId, buyerKeyPem } }),
      clear: () => dispatch({ type: "clear" }),
    }),
    [state.items, totalItems]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
}
