"use client";

import { createContext, useContext, useState } from "react";

const TabsContext = createContext<{
  value: string;
  setValue: (v: string) => void;
} | null>(null);

export function Tabs({
  defaultValue,
  children,
  className = "",
}: {
  defaultValue: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="tablist"
      className="inline-flex gap-1 rounded-[8px] border border-line bg-surface-2 p-1"
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(TabsContext)!;
  const active = ctx.value === value;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={`pressable min-h-11 rounded-[6px] px-4 text-sm font-medium ${
        active ? "bg-ember text-ivory" : "text-fg-2 hover:text-fg active:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className = "",
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsContext)!;
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}

Tabs.List = TabsList;
Tabs.Trigger = TabsTrigger;
Tabs.Content = TabsContent;
