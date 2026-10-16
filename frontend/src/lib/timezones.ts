// Time zones for the onboarding and Settings: the device's zone, the full IANA list, and readable labels.

export const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

let all: string[] | null = null;
/** Every IANA zone the browser knows, with UTC first. */
export function allZones(): string[] {
  if (all) return all;
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = sv ? sv("timeZone") : [];
  all = ["UTC", ...list.filter((z) => z !== "UTC")];
  if (!all.includes(deviceZone())) all.push(deviceZone());
  return all;
}

/** "Asia/Taipei" -> { city: "Taipei", region: "Asia" }. "America/Argentina/Salta" -> { city: "Salta", region: "America · Argentina" }. */
export function zoneLabel(zone: string) {
  const parts = zone.split("/");
  const city = parts[parts.length - 1].replace(/_/g, " ");
  return {
    city: zone === "UTC" ? "UTC" : city,
    region: zone === "UTC" ? "Coordinated Universal Time" : parts.slice(0, -1).join(" · ").replace(/_/g, " "),
  };
}

/** "GMT+8", "GMT-3:30", "GMT". */
export function offsetLabel(zone: string, at = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** The time now in that zone, e.g. "22:58". */
export function timeIn(zone: string, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(at);
  } catch {
    return "";
  }
}
