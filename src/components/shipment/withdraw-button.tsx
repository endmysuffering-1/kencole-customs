"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";

export function WithdrawButton({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="danger"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Cancel this shipment? This can't be undone.")) return;
        setBusy(true);
        try {
          await api(`/shipments/${shipmentId}/transitions`, { body: { to: "CANCELLED" } });
          router.refresh();
        } catch (err) {
          window.alert(err instanceof ApiError ? err.message : "We couldn't cancel it. Try again.");
          setBusy(false);
        }
      }}
    >
      Cancel this shipment
    </Button>
  );
}
