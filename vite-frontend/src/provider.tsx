import * as React from "react";
import { Toaster } from "react-hot-toast";

import { ThemeProvider } from "@/components/theme-provider";

export interface ProvidersProps {
  children: React.ReactNode;
}

export function Provider({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2200,
          style: {
            background: "var(--surface)",
            color: "var(--fg)",
            border: "1px solid var(--line)",
            borderRadius: "10px",
            fontSize: "13px",
            boxShadow: "var(--shadow-pop)",
          },
        }}
      />
    </ThemeProvider>
  );
}
