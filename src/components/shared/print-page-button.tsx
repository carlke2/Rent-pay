"use client";

import { Printer } from "lucide-react";
import { Button } from "./ui/button";

export function PrintPageButton({ label = "Print", large = false }: { label?: string; large?: boolean }) {
  return (
    <Button variant="outline" size={large ? "default" : "sm"} className={large ? "w-full" : undefined} onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
