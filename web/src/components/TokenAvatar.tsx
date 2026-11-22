import { useState } from "react";

export default function TokenAvatar({ token, symbol, name, imageUrl }: {
  token: string; symbol?: string; name?: string; imageUrl?: string | null;
}) {
  const [failed, setFailed] = useState<string>();
  const source = imageUrl?.trim();
  const safe = source && /^https?:\/\//i.test(source);
  const initials = (symbol?.trim() || name?.trim() || token.slice(2)).slice(0, 2).toUpperCase();
  return <span className="token-avatar" aria-hidden="true">
    {safe && failed !== source
      ? <img className="token-image" src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(source)} />
      : <span>{initials || "?"}</span>}
  </span>;
}
