import { send } from "./transport";

/** Download every answer as CSV. A plain link cannot send the sign-in token, so the file is fetched first. */
export async function downloadExport() {
  const r = await send("/api/stats/export.csv");
  if (!r.ok)
    throw new Error(r.status === 401 ? "Please sign in again." : "Something went wrong. Please try again in a moment.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "bopomofo-history.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
