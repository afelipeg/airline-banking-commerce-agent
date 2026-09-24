// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ReactNode } from "react";
import { type AgentTurn, Chat as ChatShell } from "web-shared";
import { addToCart } from "@/lib/api";
import type { CartPayload } from "@/lib/types";
import GenerativeBlock from "./generative";

const WIDE = new Set(["plan_matrix", "comparison", "credit_decision"]);

export default function Chat({
  chat,
  home,
  onCartUpdate,
  onAccountChange,
}: {
  chat: AgentTurn;
  home: ReactNode;
  onCartUpdate: (cart: CartPayload) => void;
  /** A card changed the account outside a reply (the card application form). */
  onAccountChange: () => void;
}) {
  return (
    <ChatShell
      chat={chat}
      home={home}
      wide={WIDE}
      renderBlock={(segment) => (
        <GenerativeBlock
          block={segment.block}
          status={segment.status}
          onAccountChange={onAccountChange}
          onAdd={async (product) => {
            const cart = await addToCart(product.product_id);
            if (cart) onCartUpdate(cart);
            return cart !== null;
          }}
        />
      )}
    />
  );
}
