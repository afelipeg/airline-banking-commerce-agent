// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

"use client";

import { AssistantPanel as PanelShell, type MerchantChat, type Prefill } from "web-shared";
import type { StagedChange } from "@/lib/types";
import GenerativeBlock from "./generative";

const COPY = {
  title: "Asistente de operaciones",
  intro: "Pregunta por reservas, ocupación de vuelos, ingresos ancillary, la tarjeta Quasar o las campañas.",
  starters: [
    "¿Qué necesita mi atención esta mañana?",
    "¿Qué vuelos van casi llenos y cuáles no se van a llenar a este ritmo?",
    "¿Cómo va el attach rate de servicios adicionales frente a la semana pasada?",
    "¿Cómo van las solicitudes y aprobaciones de la tarjeta Quasar esta semana?",
    "¿Qué producto del portafolio fintech deja menos margen por cuenta?",
  ],
  label: "Escribe al asistente de operaciones",
  placeholder: "Pregunta por ocupación, ancillaries, tarjeta, campañas…",
};

export default function AssistantPanel({
  chat,
  prefill,
  onPrefill,
  ...shell
}: {
  chat: MerchantChat<StagedChange>;
  prefill: Prefill | null;
  onPrefill: (text: string) => void;
  newMemoryCount: number;
  onOpenActivity: () => void;
  onClose: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <PanelShell
      chat={chat}
      copy={COPY}
      prefill={prefill}
      renderBlock={(segment) => (
        <GenerativeBlock
          block={segment.block}
          status={segment.status}
          onChangeAction={chat.actOnChange}
          onPrefill={onPrefill}
        />
      )}
      {...shell}
    />
  );
}
