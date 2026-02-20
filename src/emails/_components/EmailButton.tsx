import { Button } from "@react-email/components";
import * as React from "react";

interface EmailButtonProps {
  href: string;
  children: React.ReactNode;
}

export function EmailButton({ href, children }: EmailButtonProps) {
  return (
    <Button href={href} style={button}>
      {children}
    </Button>
  );
}

const button: React.CSSProperties = {
  display: "inline-block",
  background: "linear-gradient(to right, #f97316, #fb923c)",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 600,
  padding: "10px 16px",
  borderRadius: "8px",
  fontSize: "14px",
};
