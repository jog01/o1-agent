import { useState } from "react";

export default function TokenAvatar({ token, symbol, name, imageUrl }: {
  token: string; symbol?: string; name?: string; imageUrl?: string | null;
}) {
  const source = imageUrl?.trim() || "";
  const safe = /^https?:\/\//i.test(source) || /^\/api\/token-image\/0x[0-9a-f]{40}$/i.test(source);
  const initials = (symbol?.trim() || name?.trim() || token.slice(2)).slice(0, 2).toUpperCase();
  return <span className="token-avatar" aria-hidden="true">
    {safe
      ? <AvatarImage key={source} source={source} initials={initials || "?"} />
      : <span>{initials || "?"}</span>}
  </span>;
}

function AvatarImage({ source, initials }: { source: string; initials: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  return <>
    {status !== "loaded" && <span>{initials}</span>}
    {status !== "failed" && <img className={`token-image${status === "loaded" ? " is-loaded" : ""}`} src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />}
  </>;
}
