type CompletionPushPayload = {
  choreId: string;
  choreName: string;
  completedBy: string;
  nextDueAt: string;
};

function isCompletionPushPayload(
  value: unknown,
): value is CompletionPushPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.choreId === "string" &&
    typeof payload.choreName === "string" &&
    typeof payload.completedBy === "string" &&
    typeof payload.nextDueAt === "string" &&
    !Number.isNaN(Date.parse(payload.nextDueAt))
  );
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (!isCompletionPushPayload(payload)) {
    return Response.json(
      { ok: false, error: "Invalid completion payload." },
      { status: 400 },
    );
  }

  // This is the stable handoff point for the future Web Push provider.
  return Response.json(
    {
      ok: true,
      accepted: true,
      delivery: "not-configured",
    },
    { status: 202 },
  );
}
