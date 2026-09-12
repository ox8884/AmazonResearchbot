import "@forge-ops/ui/tokens.css";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./app.css";
import { App } from "./App.tsx";

const client = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("root missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
