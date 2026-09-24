import { vi } from "vitest";

// The console email and SMS providers log every notification with console.info.
// Status changes in the integration tests send dozens; keep them out of the output.
vi.spyOn(console, "info").mockImplementation(() => undefined);
